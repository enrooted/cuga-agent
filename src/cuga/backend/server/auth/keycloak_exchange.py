"""Delegate an authenticated chat turn to a configured MCP resource."""

import asyncio
import json
from contextlib import asynccontextmanager, nullcontext
from contextvars import ContextVar
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Request

from cuga.backend.tools_env.registry import delegation
from . import delegated_sessions
from .oidc_client import get_oidc_client


class DelegationError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


@dataclass(repr=False)
class Turn:
    handle: str
    active: bool = True


current_turn: ContextVar[Turn | None] = ContextVar("cuga_delegated_turn", default=None)


@asynccontextmanager
async def bind_turn(request: Request):
    handle = getattr(request.state, "delegated_session", None)
    turn = Turn(handle) if handle else None
    from cuga.backend.evidence_privacy import install_log_redaction, private_turn

    tracing = nullcontext()
    if turn:
        from langsmith import tracing_context
        from cuga.config import settings

        if settings.advanced_features.langfuse_tracing or settings.observability.openlit:
            raise HTTPException(503, "Disable external prompt tracing before using delegated evidence")
        install_log_redaction()
        tracing = tracing_context(enabled=False, parent=False)
    privacy = private_turn.set(bool(turn))
    binding = current_turn.set(turn)
    try:
        with tracing:
            yield
    finally:
        if turn:
            turn.active = False
        current_turn.reset(binding)
        private_turn.reset(privacy)


async def issuer_config(client):
    config = await client.get_discovery()
    issuer = client.discovery_url.removesuffix("/.well-known/openid-configuration")
    if (
        client._skip_verify
        or not issuer.startswith("https://")
        or config["issuer"] != issuer
        or any(
            urlsplit(config[k]).netloc != urlsplit(issuer).netloc or urlsplit(config[k]).scheme != "https"
            for k in ("jwks_uri", "token_endpoint", "authorization_endpoint")
        )
    ):
        raise ValueError("Delegation requires a verified HTTPS discovery document for the configured realm")
    return config


async def exchange(handle, profile):
    session = await delegated_sessions.load("session", handle) if handle else None
    if session is None:
        raise DelegationError(401, "Sign in again to use evidence tools.")
    client = get_oidc_client()
    try:
        cfg = await issuer_config(client)
        if session["issuer"] != cfg["issuer"]:
            raise ValueError("Realm changed")
        token_type = "urn:ietf:params:oauth:token-type:access_token"
        async with httpx.AsyncClient(verify=client._ssl, timeout=15, follow_redirects=False) as http:
            response = await http.post(
                cfg["token_endpoint"],
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
                    "client_id": client.client_id,
                    "client_secret": client.client_secret,
                    "subject_token": session["access_token"],
                    "subject_token_type": token_type,
                    "requested_token_type": token_type,
                    "audience": profile.audience,
                    "scope": " ".join(profile.scopes),
                },
            )
        if response.status_code in (400, 401, 403):
            try:
                reason = response.json().get("error")
            except ValueError:
                reason = None
            if reason == "invalid_client":
                raise DelegationError(502, "Check the CUGA exchange client configuration.")
            if reason == "invalid_grant":
                raise DelegationError(401, "Sign in again to use evidence tools.")
            raise DelegationError(403, "The identity provider denied evidence access.")
        response.raise_for_status()
        result = response.json()
        if result["token_type"].lower() != "bearer" or result["issued_token_type"] != token_type:
            raise ValueError("Unexpected token type")
        token = result["access_token"]
        validator = client._get_validator(cfg["jwks_uri"], cfg["issuer"])
        claims = await asyncio.to_thread(validator.validate_and_decode, token, audience=profile.audience)
        tenant = profile.tenant_claim
        if (
            not claims.get("exp")
            or claims.get("typ") != "Bearer"
            or not claims.get("sid")
            or claims.get("azp") != client.client_id
            or claims.get("sub") != session["user"]["sub"]
            or not set(profile.scopes).issubset(claims.get("scope", "").split())
            or (tenant and (not claims.get(tenant) or claims[tenant] != session["claims"].get(tenant)))
        ):
            raise ValueError("Unexpected claims")
        return token
    except DelegationError:
        raise
    except httpx.RequestError as exc:
        raise DelegationError(503, "The identity provider is unavailable.") from exc
    except Exception as exc:
        raise DelegationError(502, "Evidence token exchange or validation failed.") from exc


def trusted_registry_url(url):
    from cuga.backend.tools_env.registry.utils.api_utils import get_registry_base_url

    target = urlsplit(url)
    return url.split("?")[0] == get_registry_base_url().rstrip("/") + "/functions/call" and (
        target.scheme == "https"
        or target.scheme == "http"
        and target.hostname in ("localhost", "127.0.0.1", "::1")
    )


async def retry_headers(status, body, url, payload):
    if status != 401 or not delegation.enabled():
        return None
    try:
        challenge = json.loads(body)
    except ValueError:
        return None
    if not isinstance(challenge, dict) or challenge.get("error") != delegation.CHALLENGE:
        return None
    if not trusted_registry_url(url):
        raise DelegationError(403, "Untrusted registry connection.")
    try:
        binding = delegation.unseal(challenge["binding"])
        profile = delegation.profiles()[binding["profile"]]
        if binding["request"] != delegation.fingerprint(payload) or binding[
            "destination"
        ] != delegation.fingerprint(profile.model_dump()):
            raise ValueError("Binding changed")
    except (KeyError, ValueError) as exc:
        raise DelegationError(403, "Invalid evidence destination.") from exc
    turn = current_turn.get()
    if not turn or not turn.active:
        raise DelegationError(401, "Evidence tools require an authenticated chat turn.")
    token = await exchange(turn.handle, profile)
    if not turn.active or not await delegated_sessions.load("session", turn.handle):
        raise DelegationError(401, "The evidence session has ended.")
    return {delegation.HEADER: delegation.seal({"binding": binding, "token": token})}


async def prepare_registrations(tools, request):
    """Authenticate discovery as the manager and persist only the returned schemas."""
    from .dependencies import require_manage_access

    for entry in tools or []:
        try:
            selected = delegation.registration(entry, management=True)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if selected is None:
            continue
        from fastmcp import Client

        name, profile = selected
        await require_manage_access(request)
        try:
            token = await exchange(getattr(request.state, "delegated_session", None), profile)
            async with asyncio.timeout(25), Client(delegation.transport(profile, token)) as client:
                definitions = await client.list_tools()
            entry["auth"] = {"mode": delegation.MODE, "profile": name}
            entry["delegated_tools"] = [
                tool.model_dump(
                    by_alias=True, include={"name", "description", "input_schema", "output_schema"}
                )
                for tool in definitions
            ]
        except DelegationError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, "Authenticated evidence tool discovery failed.") from exc
