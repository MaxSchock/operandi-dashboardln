"""The way a client goes, on production as the E2E canary user, at desktop (1280) and phone (390)
width: the one request form, then the proposed script. Screenshots of every screen at both widths
go to /tmp/e2e/walk/. Nothing is paid: it stops at the script (and at any price confirmation).
Usage: python3 scripts-e2e/prod-walk-request.py form
       python3 scripts-e2e/prod-walk-request.py new "<what should happen>" [web page] [photo path]
       python3 scripts-e2e/prod-walk-request.py script <request id>
Needs cookies first: node scripts-e2e/prod-canary-cookies.js
"""
import sys, json, os, time
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
OUT = "/tmp/e2e/walk"
os.makedirs(OUT, exist_ok=True)
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
step = sys.argv[1]
SIZES = {"desktop": (1280, 900), "phone": (390, 844)}


def overflow(pg):
    """Things a person at this width cannot reach or read: wider than the screen, or cut text."""
    return pg.evaluate("""() => {
      const w = document.documentElement.clientWidth, out = [];
      if (document.documentElement.scrollWidth > w + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${w}`);
      for (const el of document.querySelectorAll('button, input, select, textarea, a')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > w + 1 || r.left < -1)) out.push(`off screen: ${(el.innerText || el.getAttribute('placeholder') || el.name || el.tagName).slice(0, 40)}`);
      }
      return out.slice(0, 12);
    }""")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    pages = {}
    for name, (w, h) in SIZES.items():
        ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=name == "phone", has_touch=name == "phone")
        ctx.add_cookies(cookies)
        pages[name] = ctx.new_page()

    def shots(tag, url):
        for name, pg in pages.items():
            pg.goto(url, wait_until="networkidle", timeout=60000)
            pg.screenshot(path=f"{OUT}/{tag}-{name}.png", full_page=True)
            print(f"{tag}-{name}:", overflow(pg) or "fits")

    if step == "form":
        shots("form", f"{BASE}/videos/new")
        pg = pages["desktop"]
        print("help:", pg.locator('[data-testid="help-page"]').inner_text().replace("\n", " "))
        print("help files:", pg.locator('[data-testid="help-files"]').inner_text().replace("\n", " | "))
        print("launch button left:", pg.locator('[data-testid="launch-open"]').count())
    elif step == "new":
        pg = pages["phone"]   # asked for on the phone, the way a client on the go would
        pg.goto(f"{BASE}/videos/new", wait_until="networkidle", timeout=60000)
        pg.locator('[name="request"]').fill(sys.argv[2])
        if len(sys.argv) > 3 and sys.argv[3]:
            pg.locator('[data-testid="request-page"]').fill(sys.argv[3])
        if len(sys.argv) > 4:
            pg.locator('input[type="file"]').set_input_files(sys.argv[4])
            pg.locator('[data-testid="file-use"]').first.select_option("person")
        pg.screenshot(path=f"{OUT}/form-filled-phone.png", full_page=True)
        pg.locator('form button[type="submit"], form button:not([type])').last.click()
        pg.wait_for_url("**/videos/*-*", timeout=120000)
        rid = pg.url.rstrip("/").rsplit("/", 1)[-1]
        print("request:", rid)
        step, sys.argv[2:] = "script", [rid]
    if step == "script":
        rid = sys.argv[2]
        pg = pages["desktop"]
        for _ in range(60):
            pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
            status = pg.locator('[data-testid="staged"]').get_attribute("data-status")
            if status == "script_ready" and not pg.locator('[data-testid="staged-working"]').count():
                break
            time.sleep(5)
        print("status:", status, "| error:", pg.locator('[data-testid="staged-error"]').inner_text() if pg.locator('[data-testid="staged-error"]').count() else "-")
        shots("script", f"{BASE}/videos/{rid}")
        print("shots:", [x.inner_text() for x in pg.locator('[data-testid="shot-what"]').all()])
        print("offers:", [x.get_attribute("data-testid") for x in pg.locator('[data-testid^="offer-"]').all()])
    b.close()
