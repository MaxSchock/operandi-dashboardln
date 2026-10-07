"""As the E2E canary: no page of the dashboard has a classic form left (one that
posts and loads the page again), and a filter redraws its list in the same document.
Usage: python3 scripts-e2e/prod-forms-inplace.py [commit]   (cookies first: node scripts-e2e/prod-canary-cookies.js)
"""
import sys, json, os, time
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
ROUTES = ["/dashboard", "/content", "/videos", "/calling", "/calling/settings", "/calling/find", "/engagement", "/distribution", "/templates", "/leads", "/activity"]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1400})
    ctx.add_cookies(cookies)
    # The newest build is live once a route only it has answers.
    for _ in range(40):
        if ctx.request.get(BASE + "/api/videos/00000000-0000-0000-0000-000000000000/status").status in (401, 404) and \
           "not found" in ctx.request.get(BASE + "/api/videos/00000000-0000-0000-0000-000000000000/status").text():
            break
        time.sleep(10)
    else:
        print("new build not live"); sys.exit(1)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:160]))
    for r in ROUTES:
        errors.clear()
        resp = pg.goto(BASE + r, wait_until="networkidle", timeout=60000)
        classic = pg.locator('form[action][method="post"], form[method="post"]').count()
        mine = pg.locator("form[aria-busy]").count()
        print(f"{r:20} {resp.status} -> {pg.url.replace(BASE, ''):22} classic forms {classic} | in-place forms {mine} | errors {errors[:2]}")
    # A filter: same document afterwards.
    for r, sel in (("/leads", "form[aria-busy]"), ("/activity", "form[aria-busy]")):
        pg.goto(BASE + r, wait_until="networkidle", timeout=60000)
        if pg.url.replace(BASE, "").split("?")[0] != r or not pg.locator(sel).count():
            print(r, "no filter form for this user"); continue
        pg.evaluate("window.__mark = 1")
        pg.locator(sel).first.locator("button").last.click()
        pg.wait_for_url("**" + r + "?*", timeout=20000)
        pg.wait_for_load_state("networkidle")
        print(r, "filter ->", pg.url.replace(BASE, "")[:70], "| same document:", pg.evaluate("window.__mark === 1"))
    b.close()
