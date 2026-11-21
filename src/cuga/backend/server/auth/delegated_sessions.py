"""Encrypted OIDC login transactions and browser sessions in CUGA's relational store."""

import hashlib
import json
import secrets
import time

from cryptography.fernet import InvalidToken

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


async def create(access_token, claims, user, max_age):
    handle = "ds." + secrets.token_urlsafe(32)
    expires = min(int(claims["exp"]), int(time.time()) + max_age)
    await save(
        "session",
        handle,
        {"access_token": access_token, "user": user.model_dump(), "issuer": claims["iss"], "claims": claims},
        expires,
    )
    return handle
