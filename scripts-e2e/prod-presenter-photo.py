"""As the canary on production: in the script, upload a photo of another person in the presenter box and
wait for the new proposal (free). Reports whether the document was loaded again and who presents after.
Usage: python3 scripts-e2e/prod-presenter-photo.py <request id> <photo path>"""
import sys, json, os
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE, OUT, rid, photo = "https://dashboardln.operandiconsultancy.com", "/tmp/e2e/walk", sys.argv[1], sys.argv[2]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900}); ctx.add_cookies(cookies)
    pg = ctx.new_page()
    docs = []
    pg.on("request", lambda r: docs.append(r.url) if r.resource_type == "document" and r.frame == pg.main_frame else None)
    pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
    note = pg.locator('[data-testid="presenter-note"]')
    print("before:", note.inner_text().split("\n")[0])
    pg.evaluate("window.__same = 1"); d0 = len(docs)
    pg.locator('[data-testid="presenter-change-photo"]').set_input_files(photo)
    pg.wait_for_timeout(4000)
    pg.screenshot(path=f"{OUT}/photo-working-desktop.png", full_page=True)
    print("working shown:", [x.inner_text() for x in pg.locator('[data-testid="working"], [data-testid="staged-working"]').all()][:3])
    for _ in range(120):
        pg.wait_for_timeout(3000)
        st = pg.locator('[data-testid="staged"]').get_attribute("data-status")
        if st == "script_ready" and not pg.locator('[data-testid="staged-working"]').count() and pg.locator('[data-testid="presenter-note"], [data-testid="script-offers"]').count():
            if not pg.locator('[data-testid="working"]').count():
                break
    pg.wait_for_timeout(3000)
    print("status:", st, "| document requests:", len(docs) - d0, "| same document:", pg.evaluate("window.__same") == 1)
    print("error:", pg.locator('[data-testid="staged-error"]').inner_text() if pg.locator('[data-testid="staged-error"]').count() else "-")
    print("after:", note.inner_text().split("\n")[0] if note.count() else "no presenter box")
    print("shots:", [x.inner_text() for x in pg.locator('[data-testid="shot-what"]').all()])
    pg.screenshot(path=f"{OUT}/photo-after-desktop.png", full_page=True)
    b.close()
