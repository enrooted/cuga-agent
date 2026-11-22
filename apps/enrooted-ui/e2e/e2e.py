# End-to-end test of the shadcn chat UI against a live CUGA pod (real LLM).
# Run (from the fork root with the original local development pod):
#   mkdir -p /tmp/cuga-e2e && chmod 777 /tmp/cuga-e2e
#   podman run --rm --restart=no --pod cuga -v $PWD/apps/enrooted-ui/e2e/e2e.py:/e2e.py:ro,Z -v /tmp/cuga-e2e:/t:Z \
#     --entrypoint /app/.venv/bin/python localhost/cuga-agent:slim /e2e.py
# Screenshots land in /tmp/cuga-e2e. The tool-approval check needs a Tool Approval
# policy on write_file; without it that check fails.
# IMPORTANT: --restart=no — containers added to the pod otherwise inherit its
# restartPolicy: Always and re-run the test in a loop.
import asyncio
import json
from playwright.async_api import async_playwright, expect

BASE = "http://localhost:7870"
OUT = "/t"
results = []


def ok(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))

        # original UI for comparison
        await page.goto("http://localhost:7860/chat")
        await page.wait_for_timeout(6000)
        await page.screenshot(path=f"{OUT}/00-original-carbon.png")

        await page.goto(f"{BASE}/chat")
        await expect(page.get_by_text("Hello, how can I help you today?")).to_be_visible(timeout=30000)
        ok("homescreen greeting", True)
        ok(
            "starter button",
            await page.get_by_role("button", name="Hi, what can you do for me?").count() == 1,
        )
        ok("enrooted logo in header", await page.get_by_role("link", name="enrooted, home").count() == 1)
        ok("Agents nav link -> /manage", await page.locator('a[href="/manage"]').count() >= 1)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{OUT}/01-home.png")

        # right panel: tools tab
        await page.get_by_role("tab", name="Tools").click()
        trig = page.get_by_role("button", name="filesystem")
        await expect(trig).to_be_visible(timeout=10000)
        ok("tools tab lists filesystem app", True)
        await trig.click()
        await expect(page.get_by_text("write_file")).to_be_visible()
        ok("tool accordion expands", True)
        await page.screenshot(path=f"{OUT}/02-tools.png")
        await page.get_by_role("tab", name="Knowledge").click()
        await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/02b-knowledge.png")
        await page.get_by_role("tab", name="Files").click()

        # slash dropdown
        box = page.get_by_label("Message", exact=True)
        await box.fill("/")
        await box.press("End")
        await page.keyboard.type("x")
        await page.keyboard.press("Backspace")
        lb = page.get_by_role("listbox", name="Slash commands")
        ok("slash dropdown opens on '/'", await lb.count() == 1)
        await page.keyboard.press("Escape")
        ok("Escape dismisses dropdown", await lb.count() == 0)
        await box.fill("")

        # 1) normal question
        await box.fill("Compute 17*23 with python and tell me the result.")
        await page.get_by_role("button", name="Send message").click()
        ok("stop button while streaming", await page.get_by_role("button", name="Stop response").count() == 1)
        await expect(page.get_by_text("391").last).to_be_visible(timeout=240000)
        ok("answer 391 rendered", True)
        await expect(page.get_by_role("button", name="Send message")).to_be_visible(timeout=60000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=f"{OUT}/03-answer.png")
        det = page.get_by_text("Show details").first
        ok("'Show details' steps toggle", await det.count() == 1)
        await det.click()
        await page.wait_for_timeout(500)
        ok("toggle relabels to 'Hide details'", await page.get_by_text("Hide details").count() >= 1)
        steps = page.get_by_text("Code Agent")
        ok("step rows listed", await steps.count() >= 1, f"{await steps.count()} Code Agent rows")
        await steps.first.click()
        await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/04-steps.png")
        await expect(page.get_by_role("button", name="Compute 17*23").first).to_be_visible(timeout=15000)
        ok("thread appears in conversation list", True)

        # 2) tool approval
        await page.get_by_role("button", name="New conversation").click()
        await expect(page.get_by_text("Hello, how can I help you today?")).to_be_visible(timeout=10000)
        await box.fill("Create a file named hello.txt containing the text hi, using the write_file tool.")
        await page.keyboard.press("Enter")
        approve = page.get_by_role("button", name="Approve & Execute")
        try:
            await expect(approve).to_be_visible(timeout=240000)
            got = True
        except Exception:
            got = False
        ok("tool-approval card shown", got)
        await page.screenshot(path=f"{OUT}/05-approval.png")
        if got:
            n_before = await page.locator('[data-slot="message"]').count()
            await approve.click()
            await expect(page.get_by_role("button", name="Send message")).to_be_visible(timeout=240000)
            await page.wait_for_timeout(1500)
            n_after = await page.locator('[data-slot="message"]').count()
            ok(
                "approval resumes stream (new assistant message)",
                n_after > n_before,
                f"{n_before}->{n_after}",
            )
            ok("card buttons disabled after answer", await approve.is_disabled())
            await page.screenshot(path=f"{OUT}/06-after-approval.png")

        # 3) stop
        await page.get_by_role("button", name="New conversation").click()
        await box.fill("Write a very long, detailed 3000-word essay on the history of computing.")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(4000)
        await page.get_by_role("button", name="Stop response").click()
        try:
            await expect(page.get_by_text("Request was cancelled.")).to_be_visible(timeout=30000)
            c = True
        except Exception:
            c = False
        ok("stop -> 'Request was cancelled.'", c)
        await page.screenshot(path=f"{OUT}/07-stopped.png")

        # 4) history reload (read-only)
        await page.reload()
        await expect(page.get_by_role("button", name="Compute 17*23").first).to_be_visible(timeout=20000)
        await page.get_by_role("button", name="Compute 17*23").first.click()
        await expect(page.get_by_text("391").last).to_be_visible(timeout=20000)
        ok("history replay shows answer", True)
        ok("history replay shows steps", await page.get_by_text("Show details").count() >= 1)
        ok("past thread read-only badge", await page.get_by_text("Read-only").count() == 1)
        ok("composer disabled for past thread", await box.is_disabled())
        await page.screenshot(path=f"{OUT}/08-history.png")

        # 5) /manage is this UI's own agent dashboard (full test: e2e/manage.py)
        r = await page.goto(f"{BASE}/manage")
        await page.wait_for_timeout(4000)
        ok(
            "/manage shows the agent dashboard",
            r.status == 200 and await page.get_by_role("heading", name="Agent dashboard").count() == 1,
        )
        await page.screenshot(path=f"{OUT}/09-manage-via-7870.png")

        # 6) mobile
        m = await browser.new_context(viewport={"width": 390, "height": 844})
        mp = await m.new_page()
        await mp.goto(f"{BASE}/chat")
        await mp.wait_for_timeout(4000)
        await mp.screenshot(path=f"{OUT}/10-mobile.png")
        await mp.get_by_role("button", name="Open navigation").click()
        await mp.wait_for_timeout(800)
        await mp.screenshot(path=f"{OUT}/11-mobile-conversations.png")
        ok(
            "mobile navigation drawer (rail + conversations)",
            await mp.get_by_label("Search conversations").count() == 1
            and await mp.get_by_role("button", name="New conversation").count() == 1,
        )

        real_errors = [e for e in errors if "favicon" not in e]
        ok("no console errors", not real_errors, "; ".join(real_errors)[:600])
        await browser.close()
    print(json.dumps({"passed": sum(r[1] for r in results), "total": len(results)}))


asyncio.run(main())
