"""Browser checks for the built Enrooted UI. Run npm run build in apps/enrooted-ui first."""

from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
import pytest


@pytest.mark.manual
@pytest.mark.parametrize(
    ("locale", "width", "theme"), [("en", 1440, "light"), ("sv", 390, "dark"), ("sv", 320, "light")]
)
def test_ai_disclosure_before_interaction(locale, width, theme, tmp_path):
    dist = Path(__file__).resolve().parents[2] / "apps/enrooted-ui/dist"
    assert (dist / "index.html").exists(), "Build apps/enrooted-ui before running this test"
    origin = "http://localhost"
    disclosure = (
        "You’re chatting with an AI assistant." if locale == "en" else "Du chattar med en AI-assistent."
    )
    guide = {
        "id": "guide",
        "name": "Example guide",
        "policy_type": "tool_guide",
        "enabled": True,
        "target_tools": ["example"],
        "triggers": [],
    }
    model_requests = []

    def serve_ui(route):
        path = urlsplit(route.request.url).path
        if path.startswith("/_ui/"):
            return route.fulfill(path=dist / path.lstrip("/"))
        if route.request.resource_type == "document":
            return route.fulfill(path=dist / "index.html")
        if path in ("/api/concierge", "/stream") or path.endswith("/tool-guards/generate"):
            model_requests.append(path)
        responses = {
            "/api/events/status": {"enabled": True, "features": {}, "backends": []},
            "/api/conversations": {"id": "test-thread"} if route.request.method == "POST" else [],
            "/api/manage/config": {
                "version": "draft",
                "config": {"policies": {"enablePolicies": True, "policies": [guide]}},
            },
        }
        return route.fulfill(json=responses.get(path, {}))

    with sync_playwright() as playwright, playwright.chromium.launch() as browser:
        page = browser.new_page(locale=locale, viewport={"width": width, "height": 844}, color_scheme=theme)
        page.route("**/*", serve_ui)
        for path in ("/chat", "/manage/cuga-default", "/studio?section=concierge"):
            page.goto(origin + path)
            if path.startswith("/manage") and width < 1024:
                page.get_by_role("tab", name="Testa").click()
            notice = page.get_by_text(disclosure, exact=True)
            if path.startswith("/studio"):
                label = "Message to the concierge" if locale == "en" else "Meddelande till Concierge"
            else:
                label = "Message" if locale == "en" else "Meddelande"
            field = page.get_by_role("textbox", name=label, exact=True)
            expect(notice).to_be_in_viewport()
            expect(field).to_have_accessible_description(disclosure)
            field.fill("Hello")
            expect(notice).to_be_in_viewport()
            page.screenshot(path=tmp_path / f"{path.split('?')[0].strip('/').replace('/', '-')}-{locale}.png")

        page.goto(origin + "/manage/cuga-default")
        page.get_by_role("button", name="Policies" if locale == "en" else "Policyer", exact=True).click()
        page.get_by_role(
            "button", name="Configure policies" if locale == "en" else "Konfigurera policyer"
        ).click()
        page.get_by_role("tab", name="Tool Guide (1)" if locale == "en" else "Verktygsguider (1)").click()
        action = "Generate guard with AI" if locale == "en" else "Skapa verktygsskydd med AI"
        generate = page.get_by_role("button", name=action)
        expect(generate).to_have_text(action)
        generate.scroll_into_view_if_needed()
        expect(generate).to_be_in_viewport(ratio=1)
        assert model_requests == []
