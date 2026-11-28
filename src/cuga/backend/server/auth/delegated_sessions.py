"""Encrypted OIDC login transactions and browser sessions in CUGA's relational store."""

import asyncio
import hashlib
import json
import secrets
import time

import httpx
import jwt
from cryptography.fernet import InvalidToken
from fastapi import HTTPException

from cuga.backend.storage.secrets_store import _fernet
from cuga.backend.storage.facade import get_storage

SCHEMA = """CREATE TABLE IF NOT EXISTS cuga_delegated_sessions
            (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires BIGINT NOT NULL)"""


def _get_store():
    return get_storage().get_relational_store("delegation")


def _key(kind, handle):
    return hashlib.sha256(f"{kind}/{handle}".encode()).hexdigest()


async def save(kind, handle, data, expires):
    cipher = _fernet()
    if cipher is None:
        raise ValueError("Configure a shared CUGA_SECRET_KEY for delegated sessions")
    store = _get_store()
    await store.execute_batch(
        [
            (SCHEMA, ()),
            ("DELETE FROM cuga_delegated_sessions WHERE expires <= ?", (int(time.time()),)),
            (
                "INSERT INTO cuga_delegated_sessions (id, value, expires) VALUES (?, ?, ?)",
                (_key(kind, handle), cipher.encrypt(json.dumps(data).encode()).decode(), int(expires)),
            ),
        ]
    )


async def load(kind, handle, *, consume=False):
    store = _get_store()
    # Login creates the table before issuing the cookie. An arbitrary opaque cookie can arrive first.
    await store.execute(SCHEMA)
    if consume:
        query = "DELETE FROM cuga_delegated_sessions WHERE id = ? AND expires > ? RETURNING value"
    else:
        query = "SELECT value FROM cuga_delegated_sessions WHERE id = ? AND expires > ?"
    row = await store.fetchone(query, (_key(kind, handle), int(time.time())))
    await store.commit()
    if row:
        cipher = _fernet()
        if cipher is None:
            raise ValueError("Delegated session encryption key unavailable")
        try:
            return json.loads(cipher.decrypt(row["value"].encode()))
        except InvalidToken:
            return None
    return None


async def create(access_token, claims, user, max_age, *, refresh_token=None, use_id_roles=False):
    handle = "ds." + secrets.token_urlsafe(32)
    deadline = int(time.time()) + max_age
    session = {
        "access_token": access_token,
        "user": user.model_dump(),
        "issuer": claims["iss"],
        "claims": claims,
    }
    if refresh_token:
        session.update(refresh_token=refresh_token, use_id_roles=use_id_roles)
    else:
        deadline = min(deadline, int(claims["exp"]))
    await save("session", handle, session, deadline)
    return handle


async def _replace(store, key, previous, updated):
    # Compare-and-swap the encrypted row. Never extend the login deadline or recreate a logged-out session.
    encrypted = _fernet().encrypt(json.dumps(updated).encode()).decode()
    row = await store.fetchone(
        "UPDATE cuga_delegated_sessions SET value = ? WHERE id = ? AND value = ? AND expires > ? RETURNING id",
        (encrypted, key, previous, int(time.time())),
    )
    await store.commit()
    return encrypted if row else None


async def active_session(handle, client):
    """Renew the browser's delegated session on demand, including during a long-running tool call."""
    if not handle or client is None:
        return None
    store = _get_store()
    await store.execute(SCHEMA)
    key = _key("session", handle)
    while True:
        now = time.time()
        row = await store.fetchone(
            "SELECT value FROM cuga_delegated_sessions WHERE id = ? AND expires > ?", (key, int(now))
        )
        if not row:
            return None
        try:
            session = json.loads(_fernet().decrypt(row["value"].encode()))
        except InvalidToken:
            return None
        if session["issuer"] != client.discovery_url.removesuffix("/.well-known/openid-configuration"):
            return None
        claims = session["claims"]
        remaining = claims["exp"] - now
        # Also support providers with token lifetimes shorter than the usual 30-second margin.
        margin = min(30, max(1, (claims["exp"] - claims.get("iat", claims["exp"] - 60)) / 4))
        if not session.get("refresh_token") or remaining > margin:
            return session if remaining > 0 else None

        # One worker owns the rotating refresh token. A crashed worker's claim expires.
        if session.get("refreshing_until", 0) > now:
            await asyncio.sleep(0.15)
            continue
        claimed = await _replace(store, key, row["value"], {**session, "refreshing_until": now + 25})
        if not claimed:
            continue
        session.pop("refreshing_until", None)
        try:
            async with asyncio.timeout(15):
                updated = await client.refresh_delegated_session(session)
        except (httpx.RequestError, jwt.PyJWKClientConnectionError, TimeoutError) as exc:
            await _replace(store, key, claimed, session)
            raise HTTPException(503, "Identity provider temporarily unavailable") from exc
        except httpx.HTTPStatusError as exc:
            try:
                reason = exc.response.json().get("error")
            except (AttributeError, ValueError):
                reason = None
            if exc.response.status_code not in (400, 401) or reason != "invalid_grant":
                await _replace(store, key, claimed, session)
                raise HTTPException(502, "Identity provider could not renew the session") from exc
            updated = None
        except (ValueError, jwt.PyJWTError):
            updated = None

        if updated is None:
            await store.execute_batch(
                [("DELETE FROM cuga_delegated_sessions WHERE id = ? AND value = ?", (key, claimed))]
            )
            return None
        return updated if await _replace(store, key, claimed, updated) else None
