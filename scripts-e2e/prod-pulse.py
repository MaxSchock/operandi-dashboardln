"""As the E2E canary: every screen answers GET /api/pulse with a mark (none of
its parts failed), the mark is the same when nothing changed, and an open
screen is not drawn again while it stays the same.
Usage: python3 scripts-e2e/prod-pulse.py   (cookies first: node scripts-e2e/prod-canary-cookies.js)
"""
import sys, json, os, time
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
PATHS = ["/dashboard", "/leads", "/activity", "/calling", "/engagement", "/distribution", "/templates", "/videos", "/admin", "/admin/health", "/content", "/videos/abc"]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1400})
    ctx.add_cookies(cookies)
    for _ in range(40):
        if ctx.request.get(BASE + "/api/pulse?path=/dashboard").status == 200: break
        time.sleep(10)
    else:
        print("new build not live"); sys.exit(1)
    bad = 0
    for path in PATHS:
        a = ctx.request.get(BASE + "/api/pulse?path=" + path).json().get("mark")
        c = ctx.request.get(BASE + "/api/pulse?path=" + path).json().get("mark")
        failed = a is not None and "x" in a.replace("|", "~").split("~")
        bad += failed
        print(f"{path:16} mark {'none' if a is None else str(len(a)) + ' chars'} | stable {a == c} | failed part {failed}")
    pg = ctx.new_page()
    asked, drawn = [], []
    pg.on("request", lambda r: (asked if "/api/pulse" in r.url else drawn if "_rsc=" in r.url and "/dashboard" in r.url else []).append(r.url))
    pg.goto(BASE + "/dashboard", wait_until="networkidle", timeout=60000)
    pg.evaluate("window.__mark = 1")
    drawn.clear()
    pg.wait_for_timeout(70000)
    print(f"/dashboard open 70 s: pulse asked {len(asked)} | redraws {len(drawn)} | same document {pg.evaluate('window.__mark') == 1}")
    b.close()
    sys.exit(1 if bad else 0)
