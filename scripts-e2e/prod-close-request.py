"""As the canary on production: close requests from their own page (reversible by an admin, nothing is charged).
Usage: python3 scripts-e2e/prod-close-request.py <request id> [<request id> ...]"""
import sys, json, os
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900}); ctx.add_cookies(cookies)
    pg = ctx.new_page()
    for rid in sys.argv[1:]:
        pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
        if not pg.locator('[data-testid="video-close-ask"]').count():
            print(rid[:8], "no close button (already closed?)"); continue
        pg.locator('[data-testid="video-close-ask"]').click()
        pg.locator('[data-testid="video-close-confirm"]').click()
        pg.wait_for_url("**/videos", timeout=30000)
        print(rid[:8], "closed; still in the list:", pg.locator(f'a[href="/videos/{rid}"]').count())
    b.close()
