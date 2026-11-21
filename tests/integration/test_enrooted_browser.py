"""Exercise a published handbook agent in two Chromium profiles using the configured model."""

import asyncio
import base64
import hashlib
import json
import os
import re
from pathlib import Path

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import serialization

pytestmark = [pytest.mark.manual, pytest.mark.asyncio]


async def login(browser, origin, name):
    page = await browser.new_page()
    await page.goto(origin + "/auth/login")
    await page.locator("#username").fill(name)
    await page.locator("#password").fill(os.environ[f"CUGA_TEST_{name.upper()}_PASSWORD"])
    async with page.expect_response(lambda r: r.url == origin + "/auth/callback") as callback:
        await page.locator("#kc-login").click()
    assert (await callback.value).ok
    return page


async def ask(page, question):
    editor = page.locator("textarea:visible, [contenteditable=true]:visible").last
    await editor.fill(question)
    async with page.expect_response(
        lambda r: r.url.endswith("/stream") and r.request.method == "POST"
    ) as streaming:
        await editor.press("Enter")
    response = await streaming.value
    assert response.ok, response.status
    data = await asyncio.wait_for(response.text(), timeout=300)
    for event in re.split(r"\r?\n\r?\n", data):
        lines = event.splitlines()
        if "event: Answer" in lines:
            answer = json.loads(next(line[6:] for line in lines if line.startswith("data: ")))
            return answer["data"]
    names = re.findall(r"(?m)^event: (.*)$", data)
    error = data.partition("event: Error")[2]
    categories = re.findall(
        r"(?i)context length|timed out|token limit|connection error|rate limit|bad request|budget|authentication|context window|HTTP [45]\d\d",
        error,
    )
    raise AssertionError(f"Chat ended without an answer. Events {names}, error categories {categories}")


async def ask_both(alice, bob, prompt):
    if os.environ.get("CUGA_TEST_CHAT_PARALLEL") == "1":
        return await asyncio.gather(ask(alice, prompt), ask(bob, prompt))
    return await ask(alice, prompt), await ask(bob, prompt)


async def read_citations(context, profile, citations):
    from fastmcp import Client
    from cuga.backend.server.auth.keycloak_exchange import exchange
    from cuga.backend.tools_env.registry.delegation import transport

    session = next(cookie["value"] for cookie in await context.cookies() if cookie["name"] == "cuga_session")
    async with Client(transport(profile, await exchange(session, profile))) as client:
        result = await client.call_tool("read_evidence", {"evidence_ids": citations})
    return result.structured_content["items"]


async def withdraw_handbook():
    issuer = os.environ["OIDC_DISCOVERY_URL"].removesuffix("/.well-known/openid-configuration")
    async with httpx.AsyncClient(verify=os.environ["SSL_CERT_FILE"]) as client:
        login = await client.post(
            issuer + "/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "live-setup",
                "username": "root",
                "password": os.environ["CUGA_TEST_FIXTURE_PASSWORD"],
            },
        )
        login.raise_for_status()
        response = await client.put(
            os.environ["CUGA_TEST_CONTEXT_API"]
            + "/v1alpha/security/resources/document/"
            + os.environ["CUGA_TEST_DOCUMENT"],
            headers={"Authorization": "Bearer " + login.json()["access_token"]},
            json={"changes": {"state": "quarantined"}, "expected_revision": 0},
        )
        response.raise_for_status()


async def test_published_handbook_in_chat():
    origin = os.environ.get("CUGA_TEST_CHAT_ORIGIN")
    if not origin:
        pytest.skip("Start deployment/enrooted/test_stack.py with --chat")
    from playwright.async_api import async_playwright

    from cuga.backend.tools_env.registry.delegation import profiles

    profile = profiles()["enrooted"]
    certificate = x509.load_pem_x509_certificate(Path(profile.ca_bundle).read_bytes())
    spki = certificate.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    pin = base64.b64encode(hashlib.sha256(spki).digest()).decode()
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            args=[
                "--no-proxy-server",
                "--host-resolver-rules=MAP localhost 127.0.0.1",
                "--ignore-certificate-errors-spki-list=" + pin,
            ]
        )
        try:
            alice_context, bob_context = await asyncio.gather(browser.new_context(), browser.new_context())
            alice, bob = await asyncio.gather(
                login(alice_context, origin, "alice"), login(bob_context, origin, "bob")
            )
            config = json.loads(Path("deployment/enrooted/agent.json").read_text())
            config["tools"][0]["url"] = profile.resource_url
            status = await alice.evaluate(
                """async config => {
                const r = await fetch("/api/manage/config", {
                    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({config})
                });
                return r.status;
            }""",
                config,
            )
            assert status == 200
            await asyncio.gather(alice.goto(origin + "/chat"), bob.goto(origin + "/chat"))
            question = (
                "How much notice is required during probation, and how does it differ from the usual rule?"
            )
            answer, denial = await ask_both(alice, bob, question)
            seven = r"(?:seven|7)\s+(?:calendar\s+)?days?"
            thirty = r"(?:thirty|30)\s+(?:calendar\s+)?days?"
            assert re.search(seven, answer, re.I) and re.search(thirty, answer, re.I)
            assert not re.search(seven + "|" + thirty, denial, re.I)
            await alice.get_by_text(re.compile(seven, re.I)).last.wait_for()
            citations = list(dict.fromkeys(re.findall(r"ev1\.[\w-]+\.[\w-]+", answer)))
            assert len(citations) >= 2
            items = await read_citations(alice_context, profile, citations)
            passages = [(item.get("passage") or {}).get("text", "") for item in items]
            assert any(re.search(seven, p, re.I) for p in passages), "The probation citation must resolve"
            assert any(re.search(thirty, p, re.I) for p in passages), "The general rule citation must resolve"
            selected = next(
                citations[item["index"]]
                for item in items
                if re.search(seven, (item.get("passage") or {}).get("text", ""), re.I)
            )
            reopen = (
                "Use read_evidence once to quote this passage exactly. If unavailable, say so. Citation: "
                + selected
            )
            quoted, unavailable = await ask_both(alice, bob, reopen)
            assert re.search(seven, quoted, re.I)
            assert not re.search(seven + "|" + thirty, unavailable, re.I)
            await withdraw_handbook()
            denied = await read_citations(alice_context, profile, citations)
            assert all(item["status"] == "unavailable" for item in denied)
        finally:
            await browser.close()
