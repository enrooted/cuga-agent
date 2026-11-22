"""Run the Podman demo with its own HTTPS Keycloak realm, volumes and ports."""

import asyncio
import base64
import hashlib
import os
import re
import socket
import ssl
import subprocess

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from playwright.async_api import async_playwright


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def wait_https(url, cert):
    async with httpx.AsyncClient(verify=ssl.create_default_context(cafile=cert)) as client:
        for _ in range(180):
            try:
                if (await client.get(url, timeout=2)).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(2)
    pytest.fail(f"Timed out waiting for {url}")


def check_chat_stream(events, api_container, verify_model_tls):
    if "event: Answer" in events and "event: Error" not in events:
        return
    ref = re.search(r"Agent request failed \(ref ([a-f0-9]+)\)", events)
    reason = f"Agent request failed (ref {ref[1]})." if ref else "Chat ended without a successful answer."
    if verify_model_tls:
        # Probe from the same container with its model trust settings. Any HTTP
        # status is sufficient to establish TLS. No model credentials are sent.
        probe = subprocess.run(
            [
                "podman",
                "exec",
                api_container,
                "/app/.venv/bin/python",
                "-c",
                "import os, ssl, httpx; "
                "ctx = ssl.create_default_context(cafile=os.getenv('CUGA_SSL_CA_BUNDLE')); "
                "httpx.head(os.environ['OPENAI_BASE_URL'], verify=ctx, timeout=5)",
            ],
            capture_output=True,
            text=True,
        )
        if "CERTIFICATE_VERIFY_FAILED" in probe.stderr:
            reason += (
                " The backend could not verify the chat model's TLS certificate. "
                "Set CUGA_TEST_CHAT_CA to its trusted CA PEM, or set CUGA_TEST_CHAT_SKIP_VERIFY=1 "
                "for the isolated Qwen lab test."
            )
    pytest.fail(reason, pytrace=False)


@pytest.mark.manual
@pytest.mark.asyncio
async def test_podman_demo(tmp_path, monkeypatch):
    model_url = os.getenv("CUGA_TEST_CHAT_URL")
    if not model_url:
        pytest.fail("Set CUGA_TEST_CHAT_URL to the OpenAI-compatible model base URL.")
    ui_port, issuer_port = free_port(), free_port()
    origin = f"https://localhost:{ui_port}"
    discovery = f"https://localhost:{issuer_port}/realms/enrooted/.well-known/openid-configuration"
    verify_model_tls = os.getenv("CUGA_TEST_CHAT_SKIP_VERIFY") != "1"
    if os.getenv("CUGA_TEST_CHAT_KEY"):
        monkeypatch.setenv("OPENAI_API_KEY", os.environ["CUGA_TEST_CHAT_KEY"])
    demo = ["deployment/enrooted/demo.sh", "keycloak", "--state-dir", str(tmp_path)]
    opts = [
        "--ui-port",
        str(ui_port),
        "--keycloak-port",
        str(issuer_port),
        "--vllm-uri",
        model_url,
        "--verify-ssl",
        str(verify_model_tls).lower(),
    ]
    for env, flag in (
        ("CUGA_TEST_CHAT_MODEL", "--model"),
        ("CUGA_TEST_CHAT_CA", "--vllm-ca"),
        ("CUGA_TEST_API_IMAGE", "--api-image"),
        ("CUGA_TEST_UI_IMAGE", "--ui-image"),
    ):
        if value := os.getenv(env):
            opts.extend((flag, value))
    if os.getenv("CUGA_TEST_API_IMAGE") and os.getenv("CUGA_TEST_UI_IMAGE"):
        opts.extend(("--pull-policy", "Never"))
    state = tmp_path / "keycloak"
    cert = state / "localhost.pem"
    try:
        subprocess.run(demo + opts, check=True)
        password = (state / "owner-password").read_text().strip()
        pod_name = (state / "prefix").read_text() + "-pod"
        await asyncio.gather(wait_https(discovery, cert), wait_https(origin + "/health", cert))
        subprocess.run(
            [
                "podman",
                "exec",
                pod_name + "-api",
                "/app/.venv/bin/python",
                "-c",
                "import os, shutil; from pathlib import Path; "
                "assert os.getuid() != 0; "
                "assert not any(shutil.which(name) for name in ('sh', 'bash')); "
                "assert not Path('/bin/sh').exists()",
            ],
            check=True,
        )
        pubkey = (
            x509.load_pem_x509_certificate(cert.read_bytes())
            .public_key()
            .public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        )
        spki = base64.b64encode(hashlib.sha256(pubkey).digest()).decode()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(args=[f"--ignore-certificate-errors-spki-list={spki}"])
            try:
                page = await browser.new_page()
                await page.goto(origin + "/chat")
                await page.locator("#username").fill("owner")
                await page.locator("#password").fill(password)
                async with page.expect_response(lambda res: res.url == origin + "/auth/callback") as callback:
                    await page.locator("#kc-login").click()
                assert (await callback.value).ok
                assert await page.evaluate("async () => (await fetch('/docs')).status") == 404
                await page.goto(origin + "/chat?view=memory")
                await page.get_by_text("Memory is on for your conversations.").wait_for()
                await page.get_by_role("button", name="Turn memory off").click()
                await page.get_by_text("Memory is off for your conversations.").wait_for()
                await page.get_by_role("button", name="Turn memory on").click()
                await page.get_by_text("Memory is on for your conversations.").wait_for()
                # This request goes through the private Evolve worker to its namespace.
                inventory = await page.evaluate(
                    """async () => {
                        const response = await fetch("/api/memory/entities?limit=1");
                        if (!response.ok) throw new Error("Evolve inventory HTTP " + response.status);
                        return response.json();
                    }"""
                )
                assert isinstance(inventory["items"], list)
                skills = await page.evaluate("async () => (await (await fetch('/api/skills')).json()).skills")
                assert any(skill["name"] == "meeting-summary" for skill in skills)
                await page.goto(origin + "/chat")
                editor = page.locator("textarea:visible, [contenteditable=true]:visible").last
                thread_ids = []
                for prompt in ("Reply with the word Hello.", "Reply with the word Goodbye."):
                    await editor.fill(prompt)
                    async with page.expect_response(
                        lambda res: res.url == origin + "/stream", timeout=90000
                    ) as stream:
                        await editor.press("Enter")
                    response = await stream.value
                    assert response.ok, response.status
                    thread_ids.append(response.request.headers.get("x-thread-id"))
                    events = await asyncio.wait_for(response.text(), timeout=240)
                    check_chat_stream(events, pod_name + "-api", verify_model_tls)
                assert thread_ids[0] and thread_ids[0] == thread_ids[1]
                history = await page.evaluate("async () => (await fetch('/api/conversations')).json()")
                assert any(t["id"] == thread_ids[0] and t["status"] == "active" for t in history)
                for database in ("cuga", "evolve"):
                    result = subprocess.check_output(
                        [
                            "podman",
                            "exec",
                            pod_name + "-postgres",
                            "psql",
                            "-U",
                            "postgres",
                            "-d",
                            database,
                            "-Atc",
                            "SELECT extname FROM pg_extension WHERE extname = 'vector'",
                        ],
                        text=True,
                    )
                    assert result.strip() == "vector"
            finally:
                await browser.close()
    finally:
        subprocess.run(demo + ["--cleanup"], check=True)
