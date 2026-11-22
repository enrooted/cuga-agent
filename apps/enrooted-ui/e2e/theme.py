# enrooted theme + light/dark switch check (no LLM calls; reads existing history).
# Run (from the fork root with the original local development pod):
#   mkdir -p /tmp/cuga-e2e && chmod 777 /tmp/cuga-e2e
#   podman run --rm --restart=no --pod cuga -v $PWD/apps/enrooted-ui/e2e/theme.py:/theme.py:ro,Z -v /tmp/cuga-e2e:/t:Z \
#     --entrypoint /app/.venv/bin/python localhost/cuga-agent:slim /theme.py
import asyncio
import sys
from playwright.async_api import async_playwright, expect

BASE = "http://localhost:7870"
OUT = "/t"
results = []


def ok(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


async def bg(page):
    return await page.evaluate("getComputedStyle(document.body).backgroundColor")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light")
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(f"{BASE}/chat")
        await expect(page.get_by_text("Hello, how can I help you today?")).to_be_visible(timeout=30000)
        await page.wait_for_timeout(1500)
        ok("light by default (system=light)", await bg(page) == "rgb(255, 255, 255)", await bg(page))
        ok("Lato loaded", await page.evaluate("document.fonts.check('16px Lato')"))
        ok("Poppins loaded", await page.evaluate("document.fonts.check('500 16px Poppins')"))
        ok(
            "button font is Poppins",
            "Poppins"
            in await page.get_by_role("button", name="Hi, what can you do for me?").evaluate(
                "e => getComputedStyle(e).fontFamily"
            ),
        )
        logo = page.get_by_role("img", name="enrooted").locator("visible=true")
        ok(
            "light lockup visible",
            await logo.count() == 1
            and "ljus" in (await logo.get_attribute("src") or "")
            or await logo.evaluate("e => e.naturalWidth > 0"),
        )
        await page.screenshot(path=f"{OUT}/t1-light-home.png")

        # open the most recent conversation to see steps, bubbles, code
        items = page.locator("[data-slot=conversation-item]")
        if await items.count():
            await items.first.click()
            await page.wait_for_timeout(2500)
            sd = page.get_by_role("button", name="Show details")
            if await sd.count():
                await sd.first.click()
                await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/t2-light-thread.png")

        # switch to dark via the header menu
        await page.get_by_role("button", name="Theme").click()
        await page.get_by_role("menuitemradio", name="Dark").click()
        await page.wait_for_timeout(600)
        ok(
            "dark applied",
            await page.evaluate("document.documentElement.classList.contains('dark')")
            and await bg(page) == "rgb(13, 24, 53)",
            await bg(page),
        )
        dlogo = page.get_by_role("img", name="enrooted").locator("visible=true")
        ok(
            "dark lockup swapped in",
            "mork" in (await dlogo.get_attribute("src") or "")
            or await dlogo.evaluate("e => e.naturalWidth > 0"),
        )
        await page.screenshot(path=f"{OUT}/t3-dark-thread.png")

        # persisted across reload, applied before React (inline script)
        await page.reload()
        await page.wait_for_timeout(300)
        ok(
            "dark persists after reload",
            await page.evaluate("document.documentElement.classList.contains('dark')"),
        )
        await page.wait_for_timeout(2000)
        await page.screenshot(path=f"{OUT}/t4-dark-home.png")

        # back to system: follows the OS (emulate dark OS)
        await page.get_by_role("button", name="Theme").click()
        await page.get_by_role("menuitemradio", name="System").click()
        await page.emulate_media(color_scheme="dark")
        await page.wait_for_timeout(500)
        ok("system follows OS dark", await bg(page) == "rgb(13, 24, 53)")
        await page.emulate_media(color_scheme="light")
        await page.wait_for_timeout(500)
        ok("system follows OS light", await bg(page) == "rgb(255, 255, 255)")

        # mobile, dark
        m = await browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark")
        mp = await m.new_page()
        await mp.goto(f"{BASE}/chat")
        await mp.wait_for_timeout(3000)
        await mp.screenshot(path=f"{OUT}/t5-mobile-dark.png")
        ok("mobile dark", await bg(mp) == "rgb(13, 24, 53)")
        ok("no page errors", not errors, "; ".join(errors[:3]))
        await browser.close()
    print(f"\n{sum(r[1] for r in results)}/{len(results)} passed")
    sys.exit(0 if all(r[1] for r in results) else 1)


asyncio.run(main())
