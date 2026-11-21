"""Run via deployment/enrooted/test_stack.py. Real issuer, registry, FastMCP and evidence API."""

import asyncio
from contextlib import asynccontextmanager
from html.parser import HTMLParser
import json
import os
import socket
from urllib.parse import parse_qs, urlsplit

import aiohttp
import httpx
import pytest
import uvicorn
from fastapi import FastAPI

pytestmark = [pytest.mark.manual, pytest.mark.asyncio]


class LoginForm(HTMLParser):
    action = None

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag == "form" and fields.get("id") == "kc-form-login":
            self.action = fields["action"]


async def sign_in(chat, username):
    async with httpx.AsyncClient(verify=os.environ["SSL_CERT_FILE"]) as browser:
        start = await browser.get(os.environ["CUGA_TEST_LOGIN_ORIGIN"] + "/auth/login")
        assert start.status_code == 302
        chat.cookies.update(start.cookies)
        login = await browser.get(start.headers["location"])
        form = LoginForm()
        form.feed(login.text)
        assert form.action is not None
        callback = await browser.post(
            form.action,
            data={"username": username, "password": os.environ[f"CUGA_TEST_{username.upper()}_PASSWORD"]},
        )
        assert callback.status_code == 302
        params = parse_qs(urlsplit(callback.headers["location"]).query)
    signed_in = await chat.post("/auth/callback", json={k: params[k][0] for k in ("code", "state")})
    assert signed_in.status_code == 200, signed_in.text
    assert chat.cookies["cuga_session"].startswith("ds.")


@asynccontextmanager
async def served_registry(app):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="off"))
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(15):
                while not server.started:
                    await asyncio.sleep(0.01)
            yield f"http://127.0.0.1:{port}"
        finally:
            server.should_exit = True
            await task


async def test_two_users_through_cuga_stream(monkeypatch):
    if not os.environ.get("CUGA_TEST_ALICE_PASSWORD"):
        pytest.skip("Use deployment/enrooted/test_stack.py to provision this test")
    from cuga.backend.server import main
    from cuga.backend.tools_env.registry import delegation
    from cuga.backend.tools_env.registry.config.config_loader import _create_service_config
    from cuga.backend.tools_env.registry.mcp_manager.mcp_manager import MCPManager
    from cuga.backend.tools_env.registry.registry import api_registry_server as registry
    from cuga.backend.tools_env.registry.utils import api_utils

    # Use deterministic tool choices to exercise the chat transport independently of an LLM.
    async def evidence_turn(
        query,
        *,
        api_mode,
        resume,
        thread_id,
        agent,
        disable_history,
        user_id,
        user_attachments,
        agent_id,
        current_llm,
        gateway_tokens,
        issued_thread_id,
        preloaded_snapshot,
        claim_owner,
        reset_stop_event,
    ):
        call = json.loads(query)
        payload = {"app_name": "handbook", "function_name": "handbook_" + call["tool"], "args": call["args"]}
        async with aiohttp.ClientSession() as session:
            code, body = await api_utils.post_registry_call(
                session, api_utils.get_registry_base_url() + "/functions/call", payload, 30
            )
            try:
                result = json.loads(body)
            except ValueError:
                result = body
            yield json.dumps({"code": code, "result": result})

    async def ask(browser, tool, args, *, headers=None):
        result = await browser.post(
            "/stream", json={"query": json.dumps({"tool": tool, "args": args})}, headers=headers
        )
        assert result.status_code == 200
        return result.json()

    monkeypatch.setattr(main, "event_stream", evidence_turn)
    registry_app = FastAPI()
    registry_app.add_api_route("/functions/call", registry.call_mcp_function, methods=["POST"])
    monkeypatch.setattr(registry, "database_mode", False)
    origin = os.environ["OIDC_REDIRECT_URI"].removesuffix("/manage")
    async with (
        served_registry(registry_app) as base,
        httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=origin) as alice,
        httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=origin) as bob,
    ):
        monkeypatch.setattr(api_utils, "get_registry_base_url", lambda: base)
        await asyncio.gather(sign_in(alice, "alice"), sign_in(bob, "bob"))
        registration = {
            "type": "mcp",
            "name": "handbook",
            "transport": "http",
            "url": delegation.profiles()["enrooted"].resource_url,
        }
        # Discover through Manage's normal draft route, then cold-load the saved schemas.
        response = await alice.patch("/api/manage/config/draft/tools", json={"tools": [registration]})
        assert response.is_success, response.text
        from cuga.backend.server.config_store import load_draft

        entry = (await load_draft("cuga-default"))["tools"][0]
        config = _create_service_config("handbook", entry, True)
        manager = MCPManager({"handbook": config})
        assert await manager._initialize_single_fastmcp_server("handbook", config)
        monkeypatch.setattr(registry, "mcp_manager", manager, raising=False)
        monkeypatch.setattr(registry, "registry", None, raising=False)
        query = {"query": "How much notice is required to end employment?"}
        found, denied = await asyncio.gather(
            ask(alice, "search_evidence", query), ask(bob, "search_evidence", query)
        )
        assert found["code"] == 200, found.get("result", {}).get("error")
        assert denied["result"] == {"error": "not_available"}
        rule = next(hit for hit in found["result"]["hits"] if "thirty days" in hit["text"].lower())
        boundary = (
            "section" if "section" in found["result"]["expansion"][0]["neighbor_boundaries"] else "none"
        )
        expanded = await ask(
            alice,
            "expand_evidence",
            {
                "evidence_id": rule["evidence_id"],
                "strategy": "neighbors",
                "before": 0,
                "after": 1,
                "boundary": boundary,
                "max_chunks": 2,
            },
        )
        assert expanded["code"] == 200, expanded["result"].get("error")
        exception = next(p for p in expanded["result"]["passages"] if "seven days" in p["text"].lower())
        handles = {"evidence_ids": [exception["evidence_id"], rule["evidence_id"]]}
        read, refused = await asyncio.gather(
            ask(alice, "read_evidence", handles), ask(bob, "read_evidence", handles)
        )
        assert [p["passage"]["text"] for p in read["result"]["items"]] == [exception["text"], rule["text"]]
        assert all(item["status"] == "unavailable" for item in refused["result"]["items"])
        from cuga.backend.server.auth import delegated_sessions

        bob_record = await delegated_sessions.load("session", bob.cookies["cuga_session"])
        mixed = await ask(
            alice, "read_evidence", handles, headers={"Authorization": "Bearer " + bob_record["access_token"]}
        )
        assert mixed["code"] == 401
        assert (
            await alice.post("/auth/logout", headers={"Origin": "https://unrelated.test"})
        ).status_code == 403
        async with httpx.AsyncClient(verify=os.environ["SSL_CERT_FILE"], cookies=alice.cookies) as replica:
            assert (await replica.post(os.environ["CUGA_TEST_LOGIN_ORIGIN"] + "/auth/logout")).is_success
        assert (await alice.get("/auth/userinfo")).status_code == 401
