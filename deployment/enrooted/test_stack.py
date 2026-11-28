"""Run a command against a disposable TLS Keycloak and Enrooted handbook stack."""

import base64
import importlib.util
import json
import os
from contextlib import ExitStack
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time

import httpx2
import yaml
from cryptography.fernet import Fernet


def ready(url, process=None):
    for _ in range(180):
        if process is not None and process.poll() is not None:
            break
        try:
            if httpx2.get(url, timeout=2).status_code == 200:
                return
        except httpx2.HTTPError:
            pass
        time.sleep(1)
    raise RuntimeError(f"Service failed to start at {url}")


def start(stack, folder, executable, args, env, *, label=None):
    log = stack.enter_context((folder / ((label or executable.name) + ".log")).open("w"))
    proc = subprocess.Popen([executable, *args], env=os.environ | env, stdout=log, stderr=subprocess.STDOUT)

    def stop():
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

    stack.callback(stop)
    return proc


def run(command, *, chat=False):
    root = Path(os.environ.get("ENROOTED_CONTEXT_DIR", "~/enrooted-context")).expanduser().resolve()
    spec = importlib.util.spec_from_file_location("context_live", root / "mcp-server/tests/live/stack.py")
    live = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(live)
    with tempfile.TemporaryDirectory(prefix="cuga-handbook-") as tmp, ExitStack() as stack:
        folder = Path(tmp)
        live.STATE = folder
        cert, key = folder / "ca.pem", folder / "tls.key"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=IP:127.0.0.1,DNS:localhost",
                "-keyout",
                key,
                "-out",
                cert,
            ],
            check=True,
            stderr=subprocess.DEVNULL,
        )
        import ssl

        trust = folder / "trusted.pem"
        system_bundle = ssl.get_default_verify_paths().cafile
        trust.write_bytes(
            (Path(system_bundle).read_bytes() if system_bundle else b"") + b"\n" + cert.read_bytes()
        )
        os.environ.update(SSL_CERT_FILE=str(trust), REQUESTS_CA_BUNDLE=str(trust))
        password = {
            n: secrets.token_urlsafe(24) for n in ("admin", "mcp", "chat", "root", "auditor", "alice", "bob")
        }
        kc_port = live.free_port()
        kc = f"https://127.0.0.1:{kc_port}"
        issuer = f"{kc}/realms/{live.REALM}"
        # Mount only the disposable identity server's TLS files, never the host's CA keys.
        tls = folder / "keycloak"
        tls.mkdir()
        (tls / "cert").write_bytes(cert.read_bytes())
        (tls / "key").write_bytes(key.read_bytes())
        container = subprocess.check_output(
            [
                "podman",
                "run",
                "-d",
                "--rm",
                "--userns=keep-id",
                "--user",
                f"{os.getuid()}:{os.getgid()}",
                "-p",
                f"127.0.0.1:{kc_port}:8443",
                "-v",
                f"{tls}:/mnt/tls:ro,Z",
                "-e",
                "KC_BOOTSTRAP_ADMIN_USERNAME=admin",
                "-e",
                "KC_BOOTSTRAP_ADMIN_PASSWORD",
                live.KEYCLOAK_IMAGE,
                "start-dev",
                "--https-certificate-file=/mnt/tls/cert",
                "--https-certificate-key-file=/mnt/tls/key",
                f"--hostname={kc}",
            ],
            env=os.environ | {"KC_BOOTSTRAP_ADMIN_PASSWORD": password["admin"]},
            text=True,
        ).strip()
        stack.callback(subprocess.run, ["podman", "stop", "-t", "5", container], stdout=subprocess.DEVNULL)
        ready(kc + "/realms/master")
        admin = live.Keycloak(kc, password["admin"])
        live.configure_realm(admin, password)
        prefix = f"/{live.REALM}/clients"
        client = admin.call("GET", f"{prefix}?clientId=cuga-backend").json()[0]
        chat_port = live.free_port()
        chat_origin = f"https://localhost:{chat_port}"
        redirect = chat_origin + "/manage"
        client.update(standardFlowEnabled=True, directAccessGrantsEnabled=False, redirectUris=[redirect])
        client["attributes"].update(
            {"standard.token.exchange.enabled": "true", "pkce.code.challenge.method": "S256"}
        )
        if lifetime := os.environ.get("CUGA_TEST_ACCESS_TOKEN_LIFESPAN"):
            client["attributes"]["access.token.lifespan"] = str(int(lifetime))
        admin.http.put(f"{prefix}/{client['id']}", json=client).raise_for_status()
        admin.call(
            "POST", f"{prefix}/{client['id']}/protocol-mappers/models", **live.audience_mapper("cuga-backend")
        )
        # Give the test employees CUGA chat access. Alice also configures the test agent.
        for role, users in (("ServiceUser", ["alice", "bob"]), ("ServiceOwner", ["alice"])):
            admin.call("POST", f"/{live.REALM}/roles", name=role)
            role_obj = admin.call("GET", f"/{live.REALM}/roles/{role}").json()
            for name in users:
                user = admin.call("GET", f"/{live.REALM}/users?username={name}&exact=true").json()[0]
                admin.http.post(
                    f"/{live.REALM}/users/{user['id']}/role-mappings/realm", json=[role_obj]
                ).raise_for_status()

        api_port = live.free_port()
        api = f"http://127.0.0.1:{api_port}"
        proc = start(
            stack,
            folder,
            root / ".venv/bin/enrooted-context",
            ["run", live.enrooted_config(issuer), "--insecure", "--port", str(api_port)],
            {
                "SQLITE_STORE_DIR": str(folder / "data"),
                "FILES_STORAGE_DIR": str(folder / "files"),
                "ENROOTED_PORT": str(api_port),
                "ENROOTED_CONFIG_DIR": str(folder / "config"),
            },
        )
        ready(api + "/v1/health", proc)
        seeded = live.seed_enrooted(api, issuer, password)
        mcp_port = live.free_port()
        mcp = f"https://127.0.0.1:{mcp_port}"
        (folder / "client").write_text(password["mcp"])
        (folder / "handles").write_text(
            json.dumps({"current": "k1", "keys": {"k1": base64.b64encode(os.urandom(32)).decode()}})
        )
        proc = start(
            stack,
            folder,
            root / "mcp-server/.venv/bin/enrooted-context-mcp",
            [],
            {
                "ENROOTED_MCP_MODE": "development",
                "ENROOTED_MCP_HOST": "127.0.0.1",
                "ENROOTED_MCP_PORT": str(mcp_port),
                "ENROOTED_MCP_RESOURCE_URL": mcp + "/mcp",
                "ENROOTED_MCP_TLS_CERT_FILE": str(cert),
                "ENROOTED_MCP_TLS_KEY_FILE": str(key),
                "ENROOTED_MCP_CA_BUNDLE_FILE": str(cert),
                "ENROOTED_MCP_ALLOWED_HOSTS": '["127.0.0.1"]',
                "ENROOTED_MCP_ISSUER": issuer,
                "ENROOTED_MCP_AUDIENCE": "enrooted-context-mcp",
                "ENROOTED_MCP_ALLOWED_CLIENT_IDS": '["cuga-backend"]',
                "ENROOTED_MCP_TENANT_CLAIM": "tenant",
                "ENROOTED_MCP_EXCHANGE_CLIENT_ID": "enrooted-context-mcp",
                "ENROOTED_MCP_EXCHANGE_CLIENT_SECRET_FILE": str(folder / "client"),
                "ENROOTED_MCP_ENROOTED_BASE_URL": api,
                "ENROOTED_MCP_DEFAULT_KNOWLEDGE_BASE": seeded["knowledge_base"],
                "ENROOTED_MCP_HANDLE_KEYS_FILE": str(folder / "handles"),
            },
        )
        ready(mcp + "/readyz", proc)
        profile = folder / "connector.yaml"
        profile.write_text(
            yaml.safe_dump(
                {
                    "delegation_profiles": {
                        "enrooted": {
                            "resource_url": mcp + "/mcp",
                            "audience": "enrooted-context-mcp",
                            "scopes": ["evidence:read"],
                            "tenant_claim": "tenant",
                            "ca_bundle": str(cert),
                        }
                    }
                }
            )
        )
        env = {
            "OIDC_DISCOVERY_URL": issuer + "/.well-known/openid-configuration",
            "OIDC_REDIRECT_URI": redirect,
            "OIDC_CLIENT_ID": "cuga-backend",
            "OIDC_CLIENT_SECRET": password["chat"],
            "DYNACONF_AUTH__ENABLED": "true",
            "DYNACONF_AUTH__REQUIRE_HTTPS": "true",
            "DYNACONF_AUTH__OIDC_CA_BUNDLE": str(cert),
            "CUGA_DBS_DIR": str(folder / "cuga"),
            "CUGA_DELEGATION_CONFIG": str(profile),
            "CUGA_SECRET_KEY": Fernet.generate_key().decode(),
            "CUGA_REGISTRY_BINDING_KEY": Fernet.generate_key().decode(),
        }
        if chat:
            model_url = os.environ["CUGA_TEST_CHAT_URL"].rstrip("/")
            model_id = os.environ["CUGA_TEST_CHAT_MODEL"]
            skip_verify = os.environ.get("CUGA_TEST_CHAT_SKIP_VERIFY") == "1"
            if not model_url.startswith("https://"):
                raise ValueError("Expected an HTTPS model endpoint")
            registry_port = live.free_port()
            registry = f"http://127.0.0.1:{registry_port}"
            env.update(
                {
                    "MODEL_NAME": model_id,
                    "OPENAI_BASE_URL": model_url,
                    "OPENAI_API_KEY": os.environ.get("CUGA_TEST_CHAT_KEY") or "keyless-demo",
                    "OPENAI_SSL_VERIFY": "false" if skip_verify else "true",
                    "CUGA_SSL_CA_BUNDLE": os.environ.get("CUGA_TEST_CHAT_CA") or str(trust),
                    "AGENT_SETTING_CONFIG": "settings.openai.toml",
                    "CUGA_MANAGER_MODE": "true",
                    "MCP_SERVERS_FILE": "none",
                    "DYNACONF_SERVER_PORTS__REGISTRY_HOST": registry,
                    "DYNACONF_SERVER_PORTS__REGISTRY": str(registry_port),
                    "DYNACONF_SERVER_PORTS__DEMO": str(chat_port),
                    "DYNACONF_POLICY__ENABLED": "false",
                    "DYNACONF_KNOWLEDGE__ENABLED": "false",
                    "DYNACONF_ADVANCED_FEATURES__MAX_TOOL_CALLS_PER_RUN": "12",
                    "DYNACONF_ADVANCED_FEATURES__CUGA_LITE_EXECUTION_MODE": "function_calling",
                    "DYNACONF_ADVANCED_FEATURES__CUGA_LITE_FC_PROMPT_FRAGMENTS": '["evidence_first"]',
                    "CUGA_TEST_CHAT_ORIGIN": chat_origin,
                }
            )
            uvicorn = ["-m", "uvicorn", "--host", "127.0.0.1", "--no-access-log", "--port"]
            proc = start(
                stack,
                folder,
                Path(sys.executable),
                [
                    *uvicorn,
                    str(registry_port),
                    "cuga.backend.tools_env.registry.registry.api_registry_server:app",
                ],
                env,
                label="registry",
            )
            ready(registry + "/status", proc)
            proc = start(
                stack,
                folder,
                Path(sys.executable),
                [
                    *uvicorn,
                    str(chat_port),
                    "--ssl-certfile",
                    str(cert),
                    "--ssl-keyfile",
                    str(key),
                    "cuga.backend.server.main:app",
                ],
                env,
                label="chat",
            )
            ready(chat_origin + "/health", proc)
        else:
            # The deterministic driver handles the callback and /stream in its own
            # ASGI process. A second worker shares only the configured store and keys.
            login_port = live.free_port()
            login_origin = f"https://localhost:{login_port}"
            proc = start(
                stack,
                folder,
                Path(sys.executable),
                [
                    "-m",
                    "uvicorn",
                    "cuga.backend.server.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(login_port),
                    "--lifespan",
                    "off",
                    "--no-access-log",
                    "--ssl-certfile",
                    str(cert),
                    "--ssl-keyfile",
                    str(key),
                ],
                env,
                label="login-worker",
            )
            ready(login_origin + "/api/auth/config", proc)
            env["CUGA_TEST_LOGIN_ORIGIN"] = login_origin
        # Only the test driver can withdraw access to the disposable fixture.
        driver_env = {
            "CUGA_TEST_ALICE_PASSWORD": password["alice"],
            "CUGA_TEST_BOB_PASSWORD": password["bob"],
            "CUGA_TEST_CONTEXT_API": api,
            "CUGA_TEST_DOCUMENT": seeded["document"],
            "CUGA_TEST_FIXTURE_PASSWORD": password["root"],
        }
        result = subprocess.run(command, env=os.environ | env | driver_env)
        if chat:
            markers = [
                "ev1.k1.",
                "how much notice is required during probation",
                "seven days",
                "thirty days",
                "bearer eyj",
                "cuga_session=ds.",
                *password.values(),
            ]
            for name in ("chat.log", "registry.log"):
                log = (folder / name).read_text(errors="replace").lower()
                if any(marker.lower() in log for marker in markers):
                    raise RuntimeError(f"Private test data appeared in {name}")
                if result.returncode and name == "chat.log":
                    import re

                    for diagnosis in re.findall(
                        r"Authenticated evidence turn ref=[a-f0-9]+ error=\w+ at \w+:\d+", log, re.I
                    ):
                        print(diagnosis, file=sys.stderr)
        return result.returncode


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chat", action="store_true", help="Start the real CUGA Chat and registry services")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command:
        parser.error("Specify the test command")
    sys.exit(run(args.command, chat=args.chat))
