"""Manage must preserve the delegated MCP identity when editing an imported agent."""

import json
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import expect, sync_playwright


@pytest.mark.manual
@pytest.mark.parametrize(("auth_key", "locale", "theme"), [("mode", "en", "light"), ("type", "sv", "dark")])
def test_edit_imported_delegated_tool(auth_key, locale, theme):
    dist = Path(__file__).resolve().parents[2] / "apps/enrooted-ui/dist"
    assert (dist / "index.html").exists(), "Build apps/enrooted-ui first"
    exchange = "keycloak_user_exchange"
    tool = {
        "name": "regulation",
        "type": "mcp",
        "transport": "http",
        "url": "https://localhost:8445/mcp",
        "auth": {auth_key: exchange, "profile": "enrooted"},
        "include": ["search_evidence"],
    }

    def serve_ui(route):
        path = urlsplit(route.request.url).path
        if path.startswith("/_ui/"):
            return route.fulfill(path=dist / path.lstrip("/"))
        if route.request.resource_type == "document":
            return route.fulfill(path=dist / "index.html")
        if path == "/api/manage/config":
            return route.fulfill(json={"config": {}, "version": "draft"})
        return route.fulfill(json={})

    with sync_playwright() as playwright, playwright.chromium.launch() as browser:
        page = browser.new_page(locale=locale, color_scheme=theme)
        page.route("**/*", serve_ui)
        page.goto("http://localhost/manage/cuga-default")
        tools_section = page.get_by_role("button", name="Tools" if locale == "en" else "Verktyg", exact=True)
        expect(tools_section).to_have_attribute("aria-expanded", "true")
        page.locator('input[type=file][accept=".json,application/json"]').set_input_files(
            {
                "name": "agent.json",
                "mimeType": "application/json",
                "buffer": json.dumps(
                    {"agent": {"name": "AI Act", "kind": "single"}, "tools": [tool]}
                ).encode(),
            }
        )
        row = page.get_by_role("listitem").filter(has_text="regulation")
        row.get_by_role("button", name="Edit" if locale == "en" else "Redigera", exact=True).click()
        dialog = page.get_by_role("dialog")
        auth = dialog.locator("#tool-auth-type")
        expect(auth).to_have_value(exchange)
        expect(auth.locator("option:checked")).to_have_text(
            "Keycloak user token exchange"
            if locale == "en"
            else "Tokenutbyte för inloggad användare via Keycloak"
        )
        expect(dialog.locator("#tool-auth-value")).to_have_count(0)
        profile = dialog.locator("#tool-delegation-profile")
        expect(profile).to_have_value("enrooted")
        save = dialog.locator("button[type=submit]")
        expect(save).to_be_enabled()
        profile.fill(" ")
        expect(save).to_be_disabled()
        profile.fill("legal-team")
        with page.expect_request(
            lambda req: (
                req.method == "PATCH"
                and urlsplit(req.url).path == "/api/manage/config/draft/tools"
                and req.post_data_json["tools"][0].get("auth", {}).get("profile") == "legal-team"
            )
        ) as request:
            save.click()
        assert request.value.post_data_json["tools"] == [
            {**tool, "auth": {"mode": exchange, "profile": "legal-team"}}
        ]
