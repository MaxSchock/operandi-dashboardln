"""A product launch video with a presenter, on production as the E2E canary user, one stage per run
so every paid step is looked at before the next one. Prices are confirmed only up to the cap given.
Usage: python3 scripts-e2e/prod-staged-launch-presenter.py new <url> [seconds] [voice]
       python3 scripts-e2e/prod-staged-launch-presenter.py <script|picture|images|film N|takes|music|assemble> <request id> [cap usd]
Needs cookies first: node scripts-e2e/prod-canary-cookies.js
"""
import sys, json, os, time
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
step = sys.argv[1]
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
os.makedirs("/tmp/e2e/shots", exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1600})
    ctx.add_cookies(cookies)
    pg = ctx.new_page()
    st = pg.locator('[data-testid="staged"]')

    def load():
        pg.goto(f"{BASE}/videos/{rid}", wait_until="networkidle", timeout=60000)
        return st.get_attribute("data-status")

    def wait_for(want, seconds=300):
        status = None
        for _ in range(seconds // 5):
            status = load()
            if status in want and not pg.locator('[data-testid="staged-working"]').count():
                return status
            time.sleep(5)
        raise SystemExit(f"still {status}, wanted {want}; error: "
                         f"{pg.locator('[data-testid=staged-error]').inner_text() if pg.locator('[data-testid=staged-error]').count() else '-'}")

    def pay(cap):
        pg.wait_for_selector('[data-testid="pay-price"]', timeout=10000)
        said = pg.locator('[data-testid="pay-price"]').inner_text()
        usd = float("".join(c for c in said.split("$")[-1] if c in "0123456789.") or 0)
        print("price:", said.replace("\n", " "), "->", usd)
        if usd > cap:
            raise SystemExit(f"{usd} is over the cap {cap}: not confirmed")
        pg.locator('[data-testid="pay-confirm"]').click()
        pg.wait_for_timeout(3000)

    def shot(name):
        try:
            pg.screenshot(path=f"/tmp/e2e/shots/lp-{name}.png", full_page=True, timeout=15000)
        except Exception as e:
            print("screenshot failed:", str(e)[:80])

    if step == "new":
        voice = sys.argv[4] if len(sys.argv) > 4 else None
        if voice:
            def add_voice(route):
                body = json.loads(route.request.post_data or "{}")
                if route.request.method == "POST" and body.get("style") == "launch":
                    body["presenter_voice"] = voice
                    return route.continue_(post_data=json.dumps(body))
                route.continue_()
            pg.route("**/api/videos", add_voice)
        pg.goto(f"{BASE}/videos/new", wait_until="networkidle", timeout=60000)
        pg.locator('[data-testid="launch-open"]').click()
        form = pg.locator('[data-testid="launch-form"]')
        form.locator('[name="product_url"]').fill(sys.argv[2])
        if len(sys.argv) > 3:
            form.locator('[name="duration_s"]').select_option(sys.argv[3])
        form.locator('[data-testid="launch-presenter"]').check()
        form.locator("button").first.click()
        pg.wait_for_url("**/videos/*-*", timeout=60000)
        rid = pg.url.rstrip("/").rsplit("/", 1)[-1]
        print("request:", rid)
        step = "script"
    else:
        rid = sys.argv[2]
    cap = float(sys.argv[-1]) if step in ("picture", "film", "music") else 0.0

    if step == "script":
        print("status:", wait_for({"script_ready"}))
        print("presenter rows:", [x.input_value() for x in pg.locator('[data-testid="host-site-text"]').all()])
        print("scenes:", [x.input_value().replace("\n", " / ") for x in pg.locator('[data-testid="shot-text"]').all()])
        shot("script")
    elif step == "approve-script":
        load()
        pg.locator('[data-testid="script-approve"]').click()
        pg.wait_for_timeout(4000)
        print("status:", wait_for({"script_approved"}))
        print("draw buttons:", [x.inner_text() for x in pg.locator('[data-testid="image-draw"]').all()])
        shot("pictures")
    elif step == "picture":
        load()
        pg.locator('[data-testid="image-draw"]').first.click()
        pay(cap)
        print("status:", wait_for({"script_approved"}, 600))
        shot("picture")
    elif step == "images":
        load()
        while pg.locator('[data-testid="image-pick"]').count():
            pg.locator('[data-testid="image-pick"]').first.click()
            pg.wait_for_timeout(3000)
            pg.wait_for_load_state("networkidle")
        pg.locator('[data-testid="images-approve"]').click()
        pg.wait_for_timeout(3000)
        print("status:", wait_for({"images_approved"}))
        for card in pg.locator('[data-testid^="shot-"]').all():
            btn = card.locator('[data-testid="shot-film"]')
            if btn.count():
                print(card.get_attribute("data-testid"), "|", btn.inner_text())
        shot("shots")
    elif step == "film":
        n = sys.argv[3]
        load()
        btn = pg.locator(f'[data-testid="shot-{n}"] [data-testid="shot-film"]')
        print("button:", btn.inner_text())
        btn.click()
        pg.wait_for_timeout(2000)
        if pg.locator('[data-testid="pay-price"]').count():
            pay(cap)
        print("status:", wait_for({"images_approved", "shots_ready"}, 3000))
        print("hands:", [x.inner_text()[:160] for x in pg.locator(f'[data-testid="shot-{n}"] [data-testid="take-hands"]').all()])
        shot(f"film-{n}")
    elif step == "takes":
        load()
        while pg.locator('[data-testid="take-pick"]').count():
            pg.locator('[data-testid="take-pick"]').first.click()
            pg.wait_for_timeout(3000)
            pg.wait_for_load_state("networkidle")
        print("status:", wait_for({"shots_ready"}))
        shot("montage")
    elif step == "music":
        load()
        pg.locator('[data-testid="music-new"]').click()
        pay(cap)
        print("status:", wait_for({"shots_ready", "delivered"}, 900))
        shot("music")
    elif step == "assemble":
        load()
        pg.get_by_role("button", name="Assemble").first.click()
        pg.wait_for_timeout(3000)
        if pg.locator('[data-testid="pay-price"]').count():
            raise SystemExit("assembling asked for money: " + pg.locator('[data-testid="pay-price"]').inner_text())
        print("status:", wait_for({"delivered"}, 900))
        shot("end")
    b.close()
