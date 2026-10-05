"""Staged video flow on production as the E2E canary user, shots and montage: mark a change on a
frame (cancelled), change a join, assemble twice. Spends nothing.
Usage: python3 scripts-e2e/prod-staged-p4.py <request id at shots_ready>
"""
import sys, json, os
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
rid = sys.argv[1]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))

def shot(pg, name):
    try:
        pg.screenshot(path=f"/tmp/e2e/shots/staged-{name}.png", full_page=True, timeout=15000)
    except Exception as e:
        print("screenshot failed:", str(e)[:80])

def mark(pg, label):
    pg.locator('[data-testid="take-refilm"]').nth(2).click()
    box = pg.locator('[data-testid="marker"]').bounding_box()
    pg.mouse.move(box["x"] + box["width"] * .3, box["y"] + box["height"] * .3)
    pg.mouse.down(); pg.mouse.move(box["x"] + box["width"] * .7, box["y"] + box["height"] * .6, steps=5); pg.mouse.up()
    print(label, "marker", round(box["width"]), "x", round(box["height"]), "| area drawn:",
          pg.get_by_text("Only the marked area changes").count() == 1, "| price:", pg.locator('[data-testid="pay-price"]').inner_text(),
          "| confirm blocked without a note:", pg.locator('[data-testid="mark-confirm"]').is_disabled())
    shot(pg, f"marker-{label}")
    pg.get_by_role("button", name="Cancel").click()

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1600})
    ctx.add_cookies(cookies)
    pg = ctx.new_page()
    pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
    st = pg.locator('[data-testid="staged"]')
    print("status:", st.get_attribute("data-status"), "| takes shown:", pg.locator("video").count())
    mark(pg, "desktop")
    pg.locator('[data-testid="captions-time"]').click()
    print("captions confirm:", pg.locator('[data-testid="pay-price"]').inner_text())
    pg.get_by_role("button", name="Cancel").click()
    for round_ in (1, 2):
        before = pg.locator('[data-testid="deliverable"]').inner_text() if pg.locator('[data-testid="deliverable"]').count() else "none"
        if round_ == 2:
            pg.locator('[data-testid="join-1>2"]').select_option("fadeblack")
            pg.locator('[data-testid="montage-end-text"]').fill("Interesse ist da.\nDie Frage ist da.\nMadeleine auch.")
        pg.locator('[data-testid="assemble"]').click()
        pg.wait_for_selector(f'[data-testid="deliverable"] >> text=Version {round_}', timeout=600000)
        err = pg.locator('[data-testid="staged-error"]')
        print("round", round_, "| before:", before.split("\n")[0], "| now:", pg.locator('[data-testid="deliverable"]').inner_text().replace("\n", " / "),
              "| status:", pg.locator('[data-testid="staged"]').get_attribute("data-status"), "| error:", err.inner_text() if err.count() else None)
    print("join kept:", pg.locator('[data-testid="join-1>2"]').input_value(), "| month:", pg.locator('[data-testid="month-spend"]').inner_text()[:60])
    shot(pg, "montage")
    m = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    m.add_cookies(cookies)
    pg = m.new_page()
    pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
    mark(pg, "mobile")
    print("mobile page wider than screen:", pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 2"))
    b.close()
