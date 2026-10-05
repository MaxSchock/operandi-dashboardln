"""Staged video flow on production as the E2E canary user: edit the script, approve it,
and check that a paid step stops at the price confirmation. Spends nothing.
Usage: python3 scripts-e2e/prod-staged-p1.py <request id>
Needs cookies first: node scripts-e2e/prod-canary-cookies.js
"""
import sys, json, os, time
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
rid = sys.argv[1]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
os.makedirs("/tmp/e2e/shots", exist_ok=True)

def shot(pg, name):
    try:
        pg.screenshot(path=f"/tmp/e2e/shots/staged-{name}.png", full_page=True, timeout=15000)
    except Exception as e:
        print("screenshot failed:", str(e)[:80])

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1600})
    ctx.add_cookies(cookies)
    pg = ctx.new_page()
    for _ in range(30):  # the deploy may still be building
        pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
        if pg.locator('[data-testid="staged"]').count():
            break
        time.sleep(10)
    st = pg.locator('[data-testid="staged"]')
    print("staged view:", st.count() == 1, "status:", st.get_attribute("data-status"))
    print("month:", pg.locator('[data-testid="month-spend"]').inner_text()[:90])
    if st.get_attribute("data-status") == "script_ready":
        rows = pg.locator('[data-testid="shot-row"]')
        print("shots:", rows.count(), "| open proposals:", pg.locator('[data-testid^="proposal-"]').count())
        words = [t.input_value() for t in pg.locator('[data-testid="shot-text"]').all()]
        cam = rows.nth(0).locator("input").last
        cam.fill("slow push in, eye level")
        pg.locator('[data-testid="script-save"]').click()
        pg.wait_for_selector('[data-testid="staged-working"]', timeout=20000)
        pg.wait_for_selector('[data-testid="staged-working"]', state="detached", timeout=180000)
        pg.wait_for_timeout(1500)
        again = [t.input_value() for t in pg.locator('[data-testid="shot-text"]').all()]
        print("save kept the words:", words == again, "| camera kept:",
              pg.locator('[data-testid="shot-row"]').nth(0).locator("input").last.input_value())
        err = pg.locator('[data-testid="staged-error"]')
        print("error:", err.inner_text() if err.count() else None)
        shot(pg, "script")
        pg.locator('[data-testid="script-approve"]').click()
        pg.wait_for_selector('[data-testid="staged"][data-status="script_approved"]', timeout=180000)
    st = pg.locator('[data-testid="staged"]')
    print("status now:", st.get_attribute("data-status"))
    draw = pg.locator('[data-testid="image-draw"]')
    print("draw buttons:", draw.count(), "|", draw.first.inner_text() if draw.count() else "")
    if draw.count():
        draw.first.click()
        print("confirm shows price:", pg.locator('[data-testid="pay-price"]').inner_text(),
              "|", pg.locator('[data-testid="pay-month"]').inner_text())
        shot(pg, "pay")
        pg.get_by_role("button", name="Cancel").click()
    print("approve-images disabled:", pg.locator('[data-testid="images-approve"]').is_disabled())
    shot(pg, "images")
    b.close()
