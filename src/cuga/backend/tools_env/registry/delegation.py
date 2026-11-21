"""Operator-owned destinations for per-user Keycloak exchange and bound registry calls."""

import hashlib
import json
import os
import ssl
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from pydantic import BaseModel, ConfigDict, Field, field_validator

MODE = "keycloak_user_exchange"
CHALLENGE = "delegated_user_token_required"
HEADER = "X-Cuga-Delegated-Call"


class StripDelegatedHeader:
    """Only the backend's private registry client can supply a dispatch envelope."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            headers = [(k, v) for k, v in scope["headers"] if k.lower() != HEADER.lower().encode()]
            scope = dict(scope, headers=headers)
        await self.app(scope, receive, send)


class Profile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    resource_url: str
    audience: str = Field(min_length=1)
    scopes: tuple[str, ...] = Field(min_length=1)
    ca_bundle: str | None = None
    tenant_claim: str | None = None

    @field_validator("resource_url")
    @classmethod
    def https_resource(cls, value):
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username is not None
            or url.query
            or url.fragment
            or not url.path
            or "\\" in value
            or any(c.isspace() for c in value)
        ):
            raise ValueError("Expected an exact HTTPS resource URL with a path")
        return value

    @field_validator("scopes")
    @classmethod
    def scope_tokens(cls, values):
        if any(not value or any(c.isspace() for c in value) for value in values):
            raise ValueError("Each scope must be a single token")
        return values


def enabled():
    return bool(os.environ.get("CUGA_DELEGATION_CONFIG"))


def profiles() -> dict[str, Profile]:
    import yaml

    filename = os.environ.get("CUGA_DELEGATION_CONFIG")
    if not filename:
        return {}
    data = yaml.safe_load(Path(filename).read_text())["delegation_profiles"]
    result = {name: Profile.model_validate(profile) for name, profile in data.items()}
    if len({p.resource_url for p in result.values()}) != len(result):
        raise ValueError("Each delegation profile requires a distinct resource URL")
    return result


def registration(entry, *, management=False):
    """Resolve explicit references. Manage can select a profile by its registered HTTP URL."""
    auth = entry.get("auth") or {}
    explicit = auth.get("mode") == MODE or auth.get("type") == MODE
    if not explicit and not enabled():
        return None
    available = profiles()
    name = (
        auth.get("profile")
        if explicit
        else next(
            (key for key, profile in available.items() if profile.resource_url == entry.get("url")), None
        )
    )
    if not explicit and name is None:
        return None
    profile = available.get(name)
    if (
        profile is None
        or profile.resource_url != entry.get("url")
        or entry.get("transport") != "http"
        or entry.get("type", "mcp") not in ("mcp", "mcp_server")
        or any(entry.get(k) for k in ("command", "args", "gateway", "headers", "env", "environment", "cwd"))
        or (
            explicit
            and (
                set(auth) - {"mode", "type", "profile"}
                or any(auth[k] != MODE for k in ("mode", "type") if k in auth)
            )
        )
        or (not explicit and (not management or auth not in ({}, {"type": "none"})))
    ):
        raise ValueError(
            "Invalid delegated MCP registration. Verify the profile, exact URL and HTTP transport."
        )
    return name, profile


def fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def seal(data: dict) -> str:
    return Fernet(os.environ["CUGA_REGISTRY_BINDING_KEY"]).encrypt(json.dumps(data).encode()).decode()


def unseal(value: str) -> dict:
    try:
        return json.loads(Fernet(os.environ["CUGA_REGISTRY_BINDING_KEY"]).decrypt(value.encode(), ttl=60))
    except (InvalidToken, ValueError, TypeError) as exc:
        raise ValueError("Expired or invalid registry binding") from exc


def transport(profile: Profile, token: str):
    import httpx2
    from fastmcp.client.transports import StreamableHttpTransport

    verify = ssl.create_default_context(cafile=profile.ca_bundle)

    def client_factory(*, headers, auth, follow_redirects=False, timeout=30):
        return httpx2.AsyncClient(
            headers=headers,
            auth=auth,
            timeout=timeout,
            verify=verify,
            follow_redirects=False,
            trust_env=False,
        )

    return StreamableHttpTransport(
        profile.resource_url,
        headers={"Authorization": f"Bearer {token}"},
        httpx_client_factory=client_factory,
    )


async def dispatch(manager, config, request, agent_id, envelope):
    """Handle the challenge before entering any generic trajectory or rejection tracking."""
    import asyncio
    import time
    from uuid import uuid4
    from fastapi.responses import JSONResponse
    from fastmcp import Client
    from loguru import logger

    started = time.monotonic()
    correlation = uuid4().hex
    name = config.delegation_profile
    profile = profiles().get(name)
    if profile is None or profile.resource_url != config.url or request.app_name != config.name:
        return JSONResponse({"error": "Evidence registration changed"}, status_code=403)
    tool = manager.original_tool_name_by_sanitized[request.function_name]
    binding = {
        "profile": name,
        "destination": fingerprint(profile.model_dump()),
        "registration": fingerprint([agent_id, config.model_dump(), tool]),
        "request": fingerprint(request.model_dump()),
    }
    if not envelope:
        return JSONResponse({"error": CHALLENGE, "binding": seal(binding)}, status_code=401)
    try:
        credential = unseal(envelope)
        if credential["binding"] != binding:
            raise ValueError("Registration changed")
        connection = transport(profile, credential["token"])
    except (KeyError, ValueError):
        return JSONResponse({"error": "Invalid evidence call binding"}, status_code=403)
    status = 502
    try:
        async with asyncio.timeout(30), Client(connection) as client:
            result = await client.call_tool(tool, request.args, raise_on_error=False)
        text = result.content[0].text if result.content else ""
        if result.is_error:
            # Expose only the server's stable error category, never upstream text or evidence.
            code = text.split(maxsplit=1)[0].rstrip(":") if text else ""
            allowed = {
                "not_available",
                "evidence_unavailable",
                "unsupported_structure",
                "unsupported_or_invalid",
                "not_expandable",
                "invalid_request",
                "knowledge_base_required",
                "reauthentication_required",
                "identity_provider_unavailable",
                "backend_unavailable",
                "backend_timeout",
                "backend_error",
                "throttled",
                "not_supported",
                "response_too_large",
            }
            code = code if code in allowed else "evidence_error"
            status = {
                "reauthentication_required": 401,
                "not_available": 403,
                "evidence_unavailable": 404,
                "throttled": 429,
                "identity_provider_unavailable": 503,
                "backend_unavailable": 503,
                "backend_error": 502,
                "backend_timeout": 504,
            }.get(code, 422)
            return JSONResponse({"error": code}, status_code=status)
        content = result.structured_content
        if content is None:
            try:
                content = json.loads(text)
            except json.JSONDecodeError:
                content = text
        status = 200
        return JSONResponse(content)
    except TimeoutError:
        status = 504
        return JSONResponse({"error": "Evidence call timed out"}, status_code=status)
    except Exception:
        return JSONResponse({"error": "Evidence service unavailable"}, status_code=status)
    finally:
        logger.info(
            "Evidence call {} tool={} status={} duration_ms={:.0f}",
            correlation,
            tool,
            status,
            (time.monotonic() - started) * 1000,
        )
