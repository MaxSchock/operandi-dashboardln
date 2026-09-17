"""Open production pages as the E2E canary user, print whether each needle is on the page, and screenshot.
Usage: python3 scripts-e2e/prod-canary-shot.py /videos/new "15-30s recommended" "Some other text"
Needs cookies first: node scripts-e2e/prod-canary-cookies.js
"""
import sys, json, os
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
route, needles = sys.argv[1], sys.argv[2:]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
os.makedirs("/tmp/e2e/shots", exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1600})
    ctx.add_cookies(cookies)
    pg = ctx.new_page()
    r = pg.goto(BASE + route, wait_until="networkidle", timeout=60000)
    print(r.status, pg.url)
    txt = pg.inner_text("body")
    for n in needles:
        print("  ", n, "->", n in txt)
    out = "/tmp/e2e/shots/prod" + route.replace("/", "_") + ".png"
    try:
        pg.screenshot(path=out, full_page=True, timeout=15000)
        print("shot", out)
    except Exception as e:  # font loading sometimes hangs the screenshot; the text check already ran
        print("screenshot failed:", str(e)[:80])
    b.close()
