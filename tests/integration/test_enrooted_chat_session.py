"""Exercise the shipped UI's background poll and OIDC callback using a stub issuer."""

from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from playwright.sync_api import expect, sync_playwright


@pytest.mark.manual
@pytest.mark.parametrize("activity", ["typing", "waiting_for_answer"])
def test_background_401_preserves_chat_and_sign_in_returns_to_original_route(activity):
    dist = Path(__file__).resolve().parents[2] / "apps/enrooted-ui/dist"
    assert (dist / "index.html").exists(), "Build the Enrooted UI first"
    target = "/chat/legal?view=chat#latest"
    origin = "http://localhost"
    expired = False
    login_targets = []
    pending_stream = []

    def serve(route):
        nonlocal expired
        url = urlsplit(route.request.url)
        if url.path == "/stream":
            pending_stream.append(route)
            return
        if url.path == "/auth/login":
            login_targets.append(parse_qs(url.query)["return_to"][0])
            return route.fulfill(
                content_type="text/html",
                body="<script>location.replace('/manage?code=one&state=two')</script>",
            )
        if route.request.resource_type == "document":
            return route.fulfill(path=dist / "index.html")
        if url.path.startswith("/_ui/"):
            return route.fulfill(path=dist / url.path.lstrip("/"))
        if url.path == "/auth/userinfo":
            return route.fulfill(status=401 if expired else 200, json={"sub": "owner", "can_manage": True})
        if url.path == "/auth/callback":
            expired = False
            return route.fulfill(json={"ok": True, "redirect": login_targets[-1]})
        if url.path == "/api/workspace/tree" and expired:
            return route.fulfill(status=401, json={})
        return route.fulfill(
            json={
                "/api/auth/config": {"enabled": True, "authorization_enabled": True},
                "/api/ui/config": {"agent_registry": True},
                "/api/agents": {"agents": [{"id": "legal", "name": "Legal"}]},
                "/api/conversations": {"id": "thread"} if route.request.method == "POST" else [],
            }.get(url.path, {})
        )

    with sync_playwright() as playwright, playwright.chromium.launch() as browser:
        page = browser.new_page(locale="en")
        page.route("**/*", serve)
        page.goto(origin + target)
        draft = page.get_by_role("textbox", name="Message", exact=True)
        draft.fill("Unsent question")
        if activity == "waiting_for_answer":
            with page.expect_request(lambda req: urlsplit(req.url).path == "/stream"):
                draft.press("Enter")
        expired = True
        sign_in = page.get_by_role("button", name="Sign in", exact=True)
        expect(sign_in).to_be_visible(timeout=10000)
        if activity == "typing":
            expect(draft).to_have_value("Unsent question")
        else:
            pending_stream[0].fulfill(
                content_type="text/event-stream", body="event: Answer\ndata: Your answer arrived\n\n"
            )
            expect(page.get_by_text("Your answer arrived", exact=True)).to_be_visible()
        assert page.url == origin + target and login_targets == []
        sign_in.click()
        expect(page).to_have_url(origin + target)
        expect(draft).to_be_visible()
        assert login_targets == [target]
