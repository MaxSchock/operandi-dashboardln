"""As the canary on production: approve the script of a request (free) without leaving the page, and
screenshot the next step with the sketch of every shot, at desktop (1280) and phone (390).
Stops before anything paid. Usage: python3 scripts-e2e/prod-walk-approve.py <request id>"""
import sys, json, os, time
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE, OUT, rid = "https://dashboardln.operandiconsultancy.com", "/tmp/e2e/walk", sys.argv[1]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900}); ctx.add_cookies(cookies)
    pg = ctx.new_page()
    navs = []
    pg.on("framenavigated", lambda f: navs.append(f.url) if f == pg.main_frame else None)
    pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
    before = len(navs)
    if pg.locator('[data-testid="staged"]').get_attribute("data-status") == "script_ready":
        pg.get_by_role("button", name="Save and approve script").click()
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{OUT}/approve-working-desktop.png", full_page=True)
    for _ in range(90):
        st = pg.locator('[data-testid="staged"]').get_attribute("data-status")
        if st != "script_ready" and not pg.locator('[data-testid="staged-working"]').count():
            break
        time.sleep(2)
    print("status:", st, "| full page loads after the click:", len(navs) - before)
    print("error:", pg.locator('[data-testid="staged-error"]').inner_text() if pg.locator('[data-testid="staged-error"]').count() else "-")
    pg.wait_for_timeout(2500)
    print("sketches on the page:", pg.locator('[data-testid="shot-sketch"]').count())
    pg.screenshot(path=f"{OUT}/sketches-desktop.png", full_page=True)
    print("buttons:", [x.inner_text().strip()[:60] for x in pg.locator("button").all()][:30])
    ctx2 = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); ctx2.add_cookies(cookies)
    ph = ctx2.new_page(); ph.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000); ph.wait_for_timeout(2500)
    ph.screenshot(path=f"{OUT}/sketches-phone.png", full_page=True)
    print("phone sideways scroll:", ph.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"))
    b.close()
