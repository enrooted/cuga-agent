"""Contract tests for the opt-in delegated MCP mode."""

import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec
from cuga.backend.server.auth.jwt_validator import JWTValidator

from cuga.backend.server.auth import delegated_sessions, keycloak_exchange
from cuga.backend.storage.relational.local import LocalRelationalStore
from cuga.backend.tools_env.registry import delegation
from cuga.backend.tools_env.registry.config.config_loader import _create_service_config
from cuga.backend.tools_env.registry.utils import api_utils

pytestmark = pytest.mark.unit
URL = "https://evidence.test/mcp"
ISSUER = "https://realm.test/realms/demo"


@pytest.fixture
def configured(monkeypatch, tmp_path):
    path = tmp_path / "connector.yaml"
    path.write_text(
        json.dumps(
            {
                "delegation_profiles": {
                    "evidence": {
                        "resource_url": URL,
                        "audience": "handbook",
                        "scopes": ["evidence:read"],
                        "tenant_claim": "tenant",
                    }
                }
            }
        )
    )
    monkeypatch.setenv("CUGA_DELEGATION_CONFIG", str(path))
    monkeypatch.setenv("CUGA_REGISTRY_BINDING_KEY", Fernet.generate_key().decode())
    return {
        "url": URL,
        "transport": "http",
        "auth": {"mode": delegation.MODE, "profile": "evidence"},
        "delegated_tools": [{"name": "read_evidence", "inputSchema": {"type": "object"}}],
    }


@pytest.mark.parametrize(
    "change",
    [
        {"url": URL + "/other"},
        {"url": "https://user@evidence.test/mcp"},
        {"transport": "sse"},
        {"headers": {"Authorization": "static"}},
        {"command": "other"},
        {"env": {"TOKEN": "static"}},
        {"auth": {"mode": delegation.MODE, "profile": "missing"}},
        {"auth": {"mode": delegation.MODE, "profile": "evidence", "value": "static"}},
    ],
)
def test_profile_conflicts_rejected(configured, change):
    with pytest.raises(ValueError):
        _create_service_config("handbook", configured | change, True)


async def test_shared_pkce_is_consumed_once_and_sessions_expire(tmp_path, monkeypatch):
    db = tmp_path / "session.db"
    stores = [LocalRelationalStore(str(db)), LocalRelationalStore(str(db))]
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(delegated_sessions, "_fernet", lambda: cipher)
    monkeypatch.setattr(delegated_sessions, "_get_store", lambda: stores[0])
    await delegated_sessions.save("pkce", "state", "verifier", time.time() + 60)
    monkeypatch.setattr(delegated_sessions, "_get_store", lambda: stores[1])
    reads = await asyncio.gather(*(delegated_sessions.load("pkce", "state", consume=True) for _ in range(2)))
    assert reads.count("verifier") == 1 and reads.count(None) == 1
    await delegated_sessions.save("session", "opaque", "a-distinct-credential", time.time() - 1)
    assert await delegated_sessions.load("session", "opaque") is None
    row = await stores[0].fetchone("SELECT value FROM cuga_delegated_sessions")
    assert "a-distinct-credential" not in row["value"]
    for store in stores:
        await store.close()


@pytest.mark.parametrize(
    "change",
    [
        {"sub": "bob"},
        {"tenant": "other"},
        {"iss": "https://other.test/realms/demo"},
        {"aud": "wrong-resource"},
        {"azp": "other"},
        {"scope": "openid"},
        {"exp": None},
        {"typ": "ID"},
        {"sid": None},
    ],
)
async def test_exchange_rejects_mismatched_claims(configured, monkeypatch, change):
    claims = {
        "sub": "alice",
        "iss": ISSUER,
        "aud": "handbook",
        "tenant": "example",
        "typ": "Bearer",
        "sid": "session",
        "exp": time.time() + 60,
        "azp": "cuga",
        "scope": "evidence:read",
    } | change
    cfg = {
        "issuer": ISSUER,
        "token_endpoint": ISSUER + "/token",
        "jwks_uri": ISSUER + "/keys",
        "authorization_endpoint": ISSUER + "/auth",
    }
    signing_key = ec.generate_private_key(ec.SECP256R1())
    validator = JWTValidator(cfg["jwks_uri"], issuer=cfg["issuer"])
    monkeypatch.setattr(
        validator._client,
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=signing_key.public_key()),
    )
    client = SimpleNamespace(
        discovery_url=ISSUER + "/.well-known/openid-configuration",
        _skip_verify=False,
        _ssl=True,
        client_id="cuga",
        client_secret="test",
        get_discovery=AsyncMock(return_value=cfg),
        _get_validator=lambda keys, issuer: validator,
    )
    monkeypatch.setattr(keycloak_exchange, "get_oidc_client", lambda: client)
    monkeypatch.setattr(
        delegated_sessions,
        "active_session",
        AsyncMock(
            return_value={
                "issuer": ISSUER,
                "user": {"sub": "alice"},
                "access_token": "subject",
                "claims": {"tenant": "example"},
            }
        ),
    )
    response = httpx.Response(
        200,
        request=httpx.Request("POST", cfg["token_endpoint"]),
        json={
            "token_type": "Bearer",
            "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
            "access_token": jwt.encode(claims, signing_key, algorithm="ES256"),
        },
    )
    monkeypatch.setattr(httpx.AsyncClient, "post", AsyncMock(return_value=response))
    with pytest.raises(keycloak_exchange.DelegationError):
        await keycloak_exchange.exchange("opaque", delegation.profiles()["evidence"])


async def test_registry_retry_requires_current_turn_and_matching_profile(configured, monkeypatch):
    payload = {
        "app_name": "handbook",
        "function_name": "handbook_read_evidence",
        "args": {"evidence_ids": ["ref"]},
    }
    monkeypatch.setattr(api_utils, "get_registry_base_url", lambda: "http://127.0.0.1:8111")
    url = api_utils.get_registry_base_url() + "/functions/call"
    profile = delegation.profiles()["evidence"]
    binding = {
        "profile": "evidence",
        "destination": delegation.fingerprint(profile.model_dump()),
        "request": delegation.fingerprint(payload),
    }
    body = json.dumps({"error": delegation.CHALLENGE, "binding": delegation.seal(binding)})
    exchange = AsyncMock(return_value="issued")
    monkeypatch.setattr(keycloak_exchange, "exchange", exchange)
    monkeypatch.setattr(delegated_sessions, "load", AsyncMock(return_value={"user": {"sub": "alice"}}))
    async with keycloak_exchange.bind_turn(
        SimpleNamespace(state=SimpleNamespace(delegated_session="opaque"))
    ):
        with pytest.raises(keycloak_exchange.DelegationError):
            await keycloak_exchange.retry_headers(401, body, url, dict(payload, args={}))
        with pytest.raises(keycloak_exchange.DelegationError):
            await keycloak_exchange.retry_headers(401, body, "https://other.test/functions/call", payload)
        headers = await keycloak_exchange.retry_headers(401, body, url, payload)
        assert delegation.unseal(headers[delegation.HEADER]) == {"binding": binding, "token": "issued"}
        assert await keycloak_exchange.retry_headers(504, "", url, payload) is None
    with pytest.raises(keycloak_exchange.DelegationError):
        await keycloak_exchange.retry_headers(401, body, url, payload)
    exchange.assert_awaited_once()


@pytest.mark.parametrize(
    ("outcome", "expected_status", "expected_body"),
    [
        ("text", 200, "A plain text result"),
        ("structured", 200, {"items": []}),
        ("timeout", 504, {"error": "Evidence call timed out"}),
        ("failure", 403, {"error": "not_available"}),
    ],
)
async def test_bound_dispatch_adapter_and_timeout(
    configured, monkeypatch, outcome, expected_status, expected_body
):
    from unittest.mock import MagicMock
    from fastmcp import Client
    from cuga.backend.tools_env.registry.registry.api_registry_server import FunctionCallRequest

    profile = delegation.profiles()["evidence"]
    config = _create_service_config("handbook", configured, True)
    manager = SimpleNamespace(original_tool_name_by_sanitized={"handbook_read_evidence": "read_evidence"})
    args = {"evidence_ids": ["one", "two"], "before": 0}
    request = FunctionCallRequest(app_name="handbook", function_name="handbook_read_evidence", args=args)
    first = await delegation.dispatch(manager, config, request, "same-agent", None)
    binding = delegation.unseal(json.loads(first.body)["binding"])
    envelope = delegation.seal({"binding": binding, "token": "issued"})

    client = MagicMock(spec=Client)
    client.__aenter__.return_value = client
    client.call_tool = AsyncMock(
        return_value=SimpleNamespace(
            content=[
                SimpleNamespace(
                    text="not_available: private detail" if outcome == "failure" else "A plain text result"
                )
            ],
            is_error=outcome == "failure",
            structured_content={"items": []} if outcome == "structured" else None,
        )
    )
    if outcome == "timeout":
        client.call_tool.side_effect = TimeoutError
    monkeypatch.setattr("fastmcp.Client", lambda connection: client)
    monkeypatch.setattr(
        delegation, "transport", lambda target, token: target == profile and token == "issued"
    )

    rejected = await delegation.dispatch(manager, config, request, "changed-agent", envelope)
    assert rejected.status_code == 403
    client.call_tool.assert_not_awaited()
    response = await delegation.dispatch(manager, config, request, "same-agent", envelope)
    assert response.status_code == expected_status and json.loads(response.body) == expected_body
    client.call_tool.assert_awaited_once_with("read_evidence", args, raise_on_error=False)


@pytest.mark.parametrize(
    ("idp_error", "expected"), [("access_denied", 403), ("invalid_client", 502), ("timeout", 503)]
)
async def test_live_session_with_failed_exchange_stops_before_dispatch(
    configured, monkeypatch, idp_error, expected
):
    cfg = {"issuer": ISSUER, "token_endpoint": ISSUER + "/token"}
    client = SimpleNamespace(_ssl=True, client_id="cuga", client_secret="test")
    monkeypatch.setattr(keycloak_exchange, "get_oidc_client", lambda: client)
    monkeypatch.setattr(keycloak_exchange, "issuer_config", AsyncMock(return_value=cfg))
    monkeypatch.setattr(
        delegated_sessions,
        "active_session",
        AsyncMock(return_value={"issuer": ISSUER, "access_token": "test-user"}),
    )
    response = httpx.Response(403, json={"error": idp_error})
    post = AsyncMock(
        return_value=response, side_effect=httpx.ReadTimeout("timeout") if idp_error == "timeout" else None
    )
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with pytest.raises(keycloak_exchange.DelegationError) as refused:
        await keycloak_exchange.exchange("session", delegation.profiles()["evidence"])
    assert refused.value.status == expected
    post.assert_awaited_once()


async def test_cancelling_turn_retires_binding_in_inherited_tasks():
    ready = asyncio.Event()
    released = asyncio.Event()

    async def observer():
        ready.set()
        await released.wait()
        return keycloak_exchange.current_turn.get().active

    async def chat():
        async with keycloak_exchange.bind_turn(
            SimpleNamespace(state=SimpleNamespace(delegated_session="opaque"))
        ):
            observers.append(asyncio.create_task(observer()))
            await asyncio.Future()

    observers = []
    task = asyncio.create_task(chat())
    await ready.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    released.set()
    assert not await observers[0]
    assert keycloak_exchange.current_turn.get() is None


@pytest.mark.parametrize("logout_during_refresh", [False, True])
async def test_renewing_polls_share_rotation_and_respect_logout(tmp_path, monkeypatch, logout_during_refresh):
    from cuga.backend.server.auth.models import UserInfo

    store = LocalRelationalStore(str(tmp_path / "session.db"))
    monkeypatch.setattr(delegated_sessions, "_get_store", lambda: store)
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(delegated_sessions, "_fernet", lambda: cipher)
    claims = {"iss": ISSUER, "exp": int(time.time()) - 1, "sid": "original"}
    handle = await delegated_sessions.create(
        "old", claims, UserInfo(sub="alice"), 3600, refresh_token="first"
    )
    started, finish = asyncio.Event(), asyncio.Event()

    async def rotate(session):
        started.set()
        await finish.wait()
        assert session["refresh_token"] == "first"
        return {
            **session,
            "access_token": "new",
            "refresh_token": "second",
            "claims": {**claims, "exp": time.time() + 120},
        }

    client = SimpleNamespace(
        discovery_url=ISSUER + "/.well-known/openid-configuration",
        refresh_delegated_session=AsyncMock(side_effect=rotate),
    )
    try:
        deadline = (await store.fetchone("SELECT expires FROM cuga_delegated_sessions"))["expires"]
        polls = [asyncio.create_task(delegated_sessions.active_session(handle, client)) for _ in range(4)]
        await asyncio.wait_for(started.wait(), 3)
        if logout_during_refresh:
            await delegated_sessions.load("session", handle, consume=True)
        finish.set()
        results = await asyncio.gather(*polls)
        client.refresh_delegated_session.assert_awaited_once()
        if logout_during_refresh:
            assert results == [None] * 4
        else:
            assert all(result["access_token"] == "new" for result in results)
            row = await store.fetchone("SELECT value, expires FROM cuga_delegated_sessions")
            assert row["expires"] == deadline
            assert json.loads(cipher.decrypt(row["value"].encode()))["refresh_token"] == "second"
            await store.execute_batch([("UPDATE cuga_delegated_sessions SET expires = 0", ())])
            assert await delegated_sessions.active_session(handle, client) is None
    finally:
        await store.close()


@pytest.mark.parametrize(
    "path",
    [
        "/chat/research?view=memory#last",
        "/studio",
        "/manage/my-agent",
        "/",
        "//elsewhere.test",
        "https://elsewhere.test",
        "/chat/../auth/logout",
        "/chat\\elsewhere",
        "/auth/logout",
    ],
)
def test_oidc_return_locations(path):
    from cuga.backend.server.auth.oidc_client import ui_return_path

    expected = (
        path if path in {"/chat/research?view=memory#last", "/studio", "/manage/my-agent", "/"} else "/manage"
    )
    assert ui_return_path(path) == expected


@pytest.mark.parametrize(
    ("status", "reason", "invalidated"), [(400, "invalid_grant", True), (503, "unavailable", False)]
)
async def test_refresh_failure_invalidates_only_a_rejected_grant(
    tmp_path, monkeypatch, status, reason, invalidated
):
    from fastapi import HTTPException
    from cuga.backend.server.auth.models import UserInfo

    store = LocalRelationalStore(str(tmp_path / "session.db"))
    monkeypatch.setattr(delegated_sessions, "_get_store", lambda: store)
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(delegated_sessions, "_fernet", lambda: cipher)
    claims = {"iss": ISSUER, "exp": int(time.time()) - 1, "sid": "original"}
    handle = await delegated_sessions.create("old", claims, UserInfo(sub="alice"), 300, refresh_token="first")
    request = httpx.Request("POST", ISSUER + "/token")
    response = httpx.Response(status, json={"error": reason}, request=request)
    client = SimpleNamespace(
        discovery_url=ISSUER + "/.well-known/openid-configuration",
        refresh_delegated_session=AsyncMock(
            side_effect=httpx.HTTPStatusError("renewal failed", request=request, response=response)
        ),
    )
    try:
        if invalidated:
            assert await delegated_sessions.active_session(handle, client) is None
            assert await delegated_sessions.load("session", handle) is None
        else:
            with pytest.raises(HTTPException) as err:
                await delegated_sessions.active_session(handle, client)
            assert err.value.status_code == 502
            saved = await delegated_sessions.load("session", handle)
            assert saved["refresh_token"] == "first" and "refreshing_until" not in saved
    finally:
        await store.close()
