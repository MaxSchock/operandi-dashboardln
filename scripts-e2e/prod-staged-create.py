"""Create a video request from the one-field form on production as the E2E canary user.
With clips among the files the form must show the price of listening to them and ask
before anything is sent. Without --pay it stops at that confirmation and creates nothing.
--no-hear sends the request the way a stale page would, without the listening (nothing is
charged: the script is then written from frames of the clip alone).
Usage: python3 scripts-e2e/prod-staged-create.py [--pay | --no-hear] <language> "<request text>" [file ...]
Needs cookies first: node scripts-e2e/prod-canary-cookies.js
"""
import sys, json, os, time
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
args = sys.argv[1:]
no_hear = "--no-hear" in args
pay = "--pay" in args or no_hear
args = [a for a in args if a not in ("--pay", "--no-hear")]
lang, text, files = args[0], args[1], args[2:]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
os.makedirs("/tmp/e2e/shots", exist_ok=True)
videos = [f for f in files if f.lower().endswith((".mp4", ".mov", ".webm"))]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1600})
    ctx.add_cookies(cookies)
    pg = ctx.new_page()
    if no_hear:
        pg.route("**/api/videos/*/submit", lambda r: r.continue_(post_data=json.dumps({"hear": False})))
    for _ in range(30):  # the deploy may still be building
        pg.goto(f"{BASE}/videos/new", wait_until="networkidle", timeout=60000)
        pg.locator('textarea[name="request"]').fill(text)
        pg.locator('select[name="language"]').select_option(lang)
        if files:
            pg.locator('input[type="file"]').set_input_files(files)
        if not videos or pg.locator('[data-testid="hear-price"]').count():
            break
        time.sleep(10)
    note = pg.locator('[data-testid="hear-price"]')
    print("price note:", note.inner_text() if note.count() else None)
    pg.get_by_role("button", name="Request storyboard").click()
    if videos:
        pg.wait_for_selector('[data-testid="pay-price"]', timeout=10000)
        print("confirm shows:", pg.locator('[data-testid="pay-price"]').inner_text(),
              "|", pg.locator('[data-testid="pay-month"]').inner_text() if pg.locator('[data-testid="pay-month"]').count() else "")
        pg.screenshot(path="/tmp/e2e/shots/create-pay.png", full_page=True)
        if not pay:
            pg.get_by_role("button", name="Cancel").click()
            pg.wait_for_timeout(1500)
            print("cancelled, still on the form:", pg.url.endswith("/videos/new"))
            b.close()
            sys.exit(0)
        pg.locator('[data-testid="pay-confirm"]').click()
    pg.wait_for_url("**/videos/*-*", timeout=600000)
    print("request:", pg.url.rsplit("/", 1)[-1])
    b.close()
