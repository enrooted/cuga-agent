"""Create credentials for one isolated Podman demo."""

import base64
import datetime
import ipaddress
import json
import os
import secrets
import subprocess
from pathlib import Path

import certifi
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def keycloak_realm(password, client_secret, redirect):
    return {
        "realm": "enrooted",
        "enabled": True,
        "roles": {"realm": [{"name": "ServiceOwner"}]},
        "clients": [
            {
                "clientId": "cuga-demo",
                "secret": client_secret,
                "protocol": "openid-connect",
                "standardFlowEnabled": True,
                "redirectUris": [redirect],
                "attributes": {"pkce.code.challenge.method": "S256"},
                "protocolMappers": [
                    {
                        "name": "cuga-audience",
                        "protocol": "openid-connect",
                        "protocolMapper": "oidc-audience-mapper",
                        "config": {"included.client.audience": "cuga-demo", "access.token.claim": "true"},
                    }
                ],
            }
        ],
        "users": [
            {
                "username": "owner",
                "firstName": "Demo",
                "lastName": "Owner",
                "email": "owner@example.test",
                "emailVerified": True,
                "enabled": True,
                "realmRoles": ["ServiceOwner"],
                "credentials": [{"type": "password", "value": password, "temporary": False}],
            }
        ],
    }


def localhost_tls(directory):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "CUGA localhost demo")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=30))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
            ),
            critical=False,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    (directory / "localhost.pem").write_text(pem)
    return pem, key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()


def provision(args, directory, prefix, redirect):
    db_password = secrets.token_urlsafe(32)
    api = {
        "DYNACONF_STORAGE__POSTGRES_URL": f"postgresql://cuga:{db_password}@127.0.0.1:5432/cuga",
        "EVOLVE_PG_PASSWORD": db_password,
        "CUGA_SECRET_KEY": base64.urlsafe_b64encode(os.urandom(32)).decode(),
        "CUGA_REGISTRY_BINDING_KEY": base64.urlsafe_b64encode(os.urandom(32)).decode(),
        "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY") or "keyless",
    }
    roots = Path(certifi.where()).read_text()
    trust = {"ca.pem": roots}
    if args.ca:
        trust["ca.pem"] += "\n" + args.ca.read_text()
    if args.vllm_ca:
        trust["model.pem"] = roots + "\n" + args.vllm_ca.read_text()
    records = {
        "db-credentials": {"POSTGRES_PASSWORD": secrets.token_urlsafe(32), "CUGA_DB_PASSWORD": db_password},
        "api-credentials": api,
        "trust": trust,
    }
    if args.scenario != "basic":
        cert, key = (args.cert.read_text(), args.key.read_text()) if args.cert else localhost_tls(directory)
        records["tls"] = {"tls.crt": cert, "tls.key": key}
    if args.scenario == "keycloak":
        password = secrets.token_urlsafe(24)
        api["OIDC_CLIENT_SECRET"] = secrets.token_urlsafe(32)
        realm = keycloak_realm(password, api["OIDC_CLIENT_SECRET"], redirect)
        records["realm"] = {"enrooted.json": json.dumps(realm)}
        (directory / "owner-password").write_text(password + "\n")
        trust["ca.pem"] += "\n" + cert
    if args.scenario == "enterprise-rag":
        api["OIDC_CLIENT_SECRET"] = os.environ["OIDC_CLIENT_SECRET"]
    docs = [
        json.dumps(
            {
                "apiVersion": "v1",
                "kind": "Secret",
                "metadata": {"name": f"{prefix}-{suffix}"},
                "data": {k: base64.b64encode(v.encode()).decode() for k, v in fields.items()},
            }
        )
        for suffix, fields in records.items()
    ]
    subprocess.run(["podman", "kube", "play", "-"], input="\n---\n".join(docs), text=True, check=True)
