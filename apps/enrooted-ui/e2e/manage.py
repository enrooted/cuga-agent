# End-to-end test of the Manage pages (dashboard + agent configuration) of the
# custom UI against a live CUGA pod. It creates a throwaway agent "UI Test Agent",
# edits, publishes and chats with it (one real model call), then deletes it.
# It never opens another agent's configuration page.
# Run (from the fork root with the original local development pod); screenshots go to the mounted /t directory:
#   mkdir -p /tmp/cuga-e2e && chmod 777 /tmp/cuga-e2e
#   podman run --rm --restart=no --pod cuga -v $PWD/apps/enrooted-ui/e2e/manage.py:/s.py:ro,Z -v /tmp/cuga-e2e:/t:Z \
#     --entrypoint /app/.venv/bin/python localhost/cuga-agent:slim /s.py
# IMPORTANT: --restart=no (a container added to the pod inherits restartPolicy: Always).
import asyncio
import json
import sys
import urllib.request
from playwright.async_api import async_playwright, expect

B = "http://localhost:7870"
A = "ui-test-agent"


def api(path):
    return json.load(urllib.request.urlopen("http://localhost:7860" + path))


res = []


def ok(n, c, d=""):
    res.append(bool(c))
    print(("PASS " if c else "FAIL ") + n + (f" — {d}" if d else ""), flush=True)


async def step(name, coro):
    try:
        await coro
    except Exception as e:
        ok(name, False, str(e).split("\n")[0][:160])


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light")
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append("PAGEERR " + str(e)))
        pg.on(
            "response",
            lambda r: (
                r.status >= 400
                and "/api/knowledge" not in r.url
                and errs.append(f"{r.status} {r.request.method} {r.url}")
            ),
        )
        # snapshot of every existing agent's config: must be identical at the end
        others = [x["id"] for x in api("/api/agents")["agents"] if x["id"] != A]
        snap = {
            i: (api(f"/api/manage/config?agent_id={i}"), api(f"/api/manage/config?agent_id={i}&draft=1"))
            for i in others
        }
        if A in [x["id"] for x in api("/api/agents")["agents"]]:
            raise SystemExit(f"{A} already exists: delete it first")

        async def dashboard():
            await pg.goto(B + "/manage")
            await expect(pg.get_by_role("heading", name="Agent dashboard")).to_be_visible(timeout=30000)
            await pg.wait_for_timeout(1500)
            await pg.screenshot(path="/t/m01-dashboard.png")
            ok(
                "dashboard lists the agents",
                await pg.locator("article").count() == len(others),
                str(len(others)),
            )
            await pg.get_by_role("button", name="Create agent").first.click()
            await pg.get_by_label("Name").fill("UI Test Agent")
            await pg.get_by_label("Description").fill("Throwaway agent for testing the custom Manage UI")
            await pg.screenshot(path="/t/m02-create-agent.png")
            await pg.get_by_role("button", name="Create", exact=True).click()
            await pg.wait_for_url(f"**/manage/{A}", timeout=20000)
            await expect(pg.get_by_label("Name (required)")).to_be_visible(timeout=30000)
            await pg.wait_for_timeout(2500)
            ok("create agent opens its configuration page", True)
            await pg.screenshot(path="/t/m03-config.png")

        await step("dashboard + create", dashboard())

        async def instructions():
            await pg.get_by_role("button", name="Special Instructions", exact=True).click()
            await pg.get_by_role("textbox", name="Special instructions").fill(
                "You are a test agent. Always end your answer with the word PINEAPPLE."
            )
            await pg.get_by_role("button", name="Save draft").click()
            await pg.wait_for_timeout(2500)
            d = api(f"/api/manage/config?agent_id={A}&draft=1")
            ok(
                "special instructions saved to draft",
                "PINEAPPLE" in (d["config"].get("special_instructions") or ""),
                str(d.get("version")),
            )

        await step("special instructions", instructions())

        async def rename():
            f = pg.get_by_label("Description")
            await f.fill("Renamed by the UI test")
            await f.blur()
            await pg.wait_for_timeout(2000)
            d = api(f"/api/manage/config?agent_id={A}&draft=1")
            ok(
                "agent description autosaved on blur",
                d["config"]["agent"].get("description") == "Renamed by the UI test",
            )

        await step("rename", rename())

        async def features():
            await pg.get_by_role("button", name="Features", exact=True).click()
            await pg.get_by_role("checkbox", name="Enable todos").click()
            await pg.get_by_role("spinbutton", name="Max steps").fill("42")
            await pg.get_by_role("button", name="Save Flags").click()
            await pg.wait_for_timeout(2500)
            ff = api(f"/api/manage/config?agent_id={A}&draft=1")["config"].get("feature_flags", {})
            ok(
                "feature flags saved (todos on, max_steps 42)",
                ff.get("enable_todos") is True and ff.get("max_steps") == 42,
                json.dumps(ff),
            )

        await step("features", features())

        async def welcome():
            await pg.get_by_role("button", name="Welcome Screen", exact=True).click()
            g = pg.get_by_label("Greeting message")
            await g.fill("Welcome to the test agent")
            await g.blur()
            await pg.wait_for_timeout(2500)
            hs = api(f"/api/manage/config?agent_id={A}&draft=1")["config"].get("homescreen", {})
            ok("welcome greeting saved", hs.get("greeting") == "Welcome to the test agent")
            ok(
                "draft chat shows the new greeting",
                await pg.get_by_text("Welcome to the test agent").count() >= 1,
            )

        await step("welcome", welcome())

        async def addtool():
            await pg.get_by_role("button", name="Add tool").click()
            await pg.wait_for_timeout(800)
            await pg.screenshot(path="/t/m04-add-tool.png")
            ok("add tool dialog opens", await pg.get_by_role("dialog").count() == 1)
            box = await pg.get_by_role("dialog").bounding_box()
            ok("add tool dialog fits the window", box["y"] >= 0 and box["y"] + box["height"] <= 900, str(box))
            await pg.get_by_role("button", name="Cancel").click()
            await pg.wait_for_timeout(400)

        await step("add tool", addtool())

        async def secrets():
            await pg.get_by_role("button", name="Manage secrets").first.click()
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path="/t/m05-secrets.png")
            ok("secrets dialog opens", await pg.get_by_role("dialog").count() == 1)
            await pg.keyboard.press("Escape")
            await pg.wait_for_timeout(500)

        await step("secrets", secrets())

        async def policies():
            await pg.get_by_role("button", name="Policies", exact=True).click()
            await pg.get_by_role("button", name="Configure policies").click()
            await pg.wait_for_timeout(1500)
            await pg.get_by_role("button", name="Add Intent Guard").click()
            await pg.wait_for_timeout(600)
            await pg.screenshot(path="/t/m06-policies.png")
            await pg.get_by_role("button", name="Save Changes").click()
            await pg.wait_for_timeout(3500)
            pol = api(f"/api/manage/config?agent_id={A}&draft=1")["config"].get("policies", {})
            ok("policy saved to THIS agent's draft", len(pol.get("policies", [])) == 1, json.dumps(pol)[:120])
            dflt = api("/api/manage/config?agent_id=cuga-default&draft=1")["config"].get("policies", {})
            ok("default agent's policies untouched", len(dflt.get("policies", [])) == 0)
            ok("policy summary on the page", await pg.get_by_text("1 policy defined").count() == 1)

        await step("policies", policies())

        async def knowledge():
            await pg.get_by_role("button", name="Knowledge", exact=True).click()
            await pg.get_by_role("button", name="Configure knowledge base").click()
            await pg.wait_for_timeout(2500)
            await pg.screenshot(path="/t/m07-knowledge.png")
            ok("knowledge dialog opens", await pg.get_by_role("dialog").count() == 1)
            for t in ("Settings", "Search Test"):
                tab = pg.get_by_role("tab", name=t)
                if await tab.count():
                    await tab.first.click()
                    await pg.wait_for_timeout(700)
                    await pg.screenshot(path=f"/t/m07-knowledge-{t.split()[0].lower()}.png")
            await pg.get_by_role("button", name="Close").last.click()
            await pg.wait_for_timeout(500)

        await step("knowledge", knowledge())

        async def publish():
            before = api(f"/api/manage/config/history?agent_id={A}").get("versions", [])
            await pg.get_by_role("button", name="Publish", exact=True).click()
            await expect(pg.get_by_role("button", name="Published")).to_be_visible(timeout=60000)
            await pg.wait_for_timeout(2500)
            after = api(f"/api/manage/config/history?agent_id={A}").get("versions", [])
            pub = api(f"/api/manage/config?agent_id={A}")
            ok("publish creates a new version", len(after) == len(before) + 1, f"{len(before)}->{len(after)}")
            c = pub["config"]
            ok(
                "published config has the edits",
                "PINEAPPLE" in (c.get("special_instructions") or "")
                and c["feature_flags"].get("max_steps") == 42
                and c["homescreen"].get("greeting") == "Welcome to the test agent"
                and len(c["policies"]["policies"]) == 1,
            )
            await pg.screenshot(path="/t/m08-published.png")

        await step("publish", publish())

        async def history():
            await pg.get_by_role("button", name="Version History", exact=True).click()
            await pg.wait_for_timeout(500)
            await pg.get_by_role("button", name="View JSON of version").first.click()
            await pg.wait_for_timeout(1500)
            ok(
                "version JSON viewer shows the config",
                await pg.get_by_role("dialog").get_by_text("PINEAPPLE").count() >= 1,
            )
            await pg.screenshot(path="/t/m09-version-json.png")
            await pg.keyboard.press("Escape")
            await pg.wait_for_timeout(400)

        await step("history", history())

        async def chat():
            box = pg.get_by_label("Message", exact=True)
            await box.fill("Say hello in five words.")
            await box.press("Enter")
            await expect(pg.get_by_text("PINEAPPLE").last).to_be_visible(timeout=240000)
            ok("draft chat answers using the draft's special instructions", True)
            await pg.wait_for_timeout(1000)
            await pg.screenshot(path="/t/m10-draft-chat.png")
            threads = api(f"/api/conversation-threads?agent_id={A}").get("threads", [])
            ok("draft chat keeps no history", len(threads) == 0, str(len(threads)))

        await step("draft chat", chat())

        async def dark_mobile():
            d = await b.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark")
            dp = await d.new_page()
            await dp.goto(f"{B}/manage/{A}")
            await dp.wait_for_timeout(4000)
            await dp.screenshot(path="/t/m11-dark-config.png")
            await dp.goto(f"{B}/manage")
            await dp.wait_for_timeout(2500)
            await dp.screenshot(path="/t/m11-dark-dashboard.png")
            m = await b.new_context(viewport={"width": 390, "height": 844})
            mp = await m.new_page()
            await mp.goto(f"{B}/manage/{A}")
            await mp.wait_for_timeout(4000)
            await mp.screenshot(path="/t/m12-mobile-config.png")
            await mp.get_by_role("tab", name="Try it").click()
            await mp.wait_for_timeout(600)
            await mp.screenshot(path="/t/m12-mobile-try.png")
            ok("mobile: Configure / Try it switch", await mp.get_by_label("Message", exact=True).is_visible())

        await step("dark + mobile", dark_mobile())

        async def delete():
            await pg.goto(f"{B}/manage")
            await expect(pg.get_by_role("heading", name="Agent dashboard")).to_be_visible(timeout=20000)
            await pg.get_by_role("button", name="Delete agent UI Test Agent").click()
            await pg.wait_for_timeout(500)
            await pg.screenshot(path="/t/m13-delete.png")
            await pg.get_by_role("button", name="Delete agent", exact=True).click()
            await pg.wait_for_timeout(3000)
            ids = [a["id"] for a in api("/api/agents")["agents"]]
            ok("agent deleted from the dashboard", A not in ids, str(ids))

        await step("delete", delete())

        same = all(
            snap[i]
            == (api(f"/api/manage/config?agent_id={i}"), api(f"/api/manage/config?agent_id={i}&draft=1"))
            for i in others
        )
        ok("every other agent's published and draft config is unchanged", same)
        ok("no failed requests (knowledge-engine 503s aside)", not errs, "; ".join(errs[:3]))
        print("errors:", json.dumps(errs[:12], indent=1))
        await b.close()
    print(f"{sum(res)}/{len(res)} passed")
    return all(res)


sys.exit(0 if asyncio.run(main()) else 1)
