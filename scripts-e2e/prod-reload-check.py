"""As the canary on production: does a button of the step-by-step page load the document again?
Sets a marker on window, clicks, and reports document requests and whether the marker survived.
Usage: python3 scripts-e2e/prod-reload-check.py <request id> <button name> [<button name> ...]"""
import sys, json, os
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE, rid, names = "https://dashboardln.operandiconsultancy.com", sys.argv[1], sys.argv[2:]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900}); ctx.add_cookies(cookies)
    pg = ctx.new_page()
    docs, navs = [], []
    pg.on("request", lambda r: docs.append(r.url) if r.resource_type == "document" and r.frame == pg.main_frame else None)
    pg.on("framenavigated", lambda f: navs.append(f.url) if f == pg.main_frame else None)
    pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
    print("status:", pg.locator('[data-testid="staged"]').get_attribute("data-status"))
    for name in names:
        pg.evaluate("window.__same = Math.random()")
        mark = pg.evaluate("window.__same")
        d0, n0 = len(docs), len(navs)
        pg.get_by_role("button", name=name, exact=True).click()
        pg.wait_for_timeout(12000)
        for _ in range(60):
            if not pg.locator('[data-testid="staged-working"]').count():
                break
            pg.wait_for_timeout(2000)
        pg.wait_for_timeout(3000)
        print(f"{name!r}: document requests {len(docs) - d0}, navigations {len(navs) - n0} {navs[n0:]}, "
              f"same document: {pg.evaluate('window.__same') == mark}, status now: "
              f"{pg.locator('[data-testid=staged]').get_attribute('data-status')}, error: "
              f"{pg.locator('[data-testid=staged-error]').inner_text() if pg.locator('[data-testid=staged-error]').count() else '-'}")
    b.close()
