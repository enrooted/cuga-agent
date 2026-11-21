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
        "load",
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
        delegated_sessions, "load", AsyncMock(return_value={"issuer": ISSUER, "access_token": "test-user"})
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
