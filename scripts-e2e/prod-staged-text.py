"""A step-by-step video made only of text on screen, on production as the E2E canary user:
edit a card in the script, approve, nothing to draw, make each card (free), approve the
takes, assemble. Spends nothing: it stops if any step asks for money.
Usage: python3 scripts-e2e/prod-staged-text.py <request id>
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
        for _ in range(seconds // 5):
            status = load()
            if status in want and not pg.locator('[data-testid="staged-working"]').count():
                return status
            time.sleep(5)
        raise SystemExit(f"still {status}, wanted {want}; error: "
                         f"{pg.locator('[data-testid=staged-error]').inner_text() if pg.locator('[data-testid=staged-error]').count() else '-'}")

    def shot(name):
        try:
            pg.screenshot(path=f"/tmp/e2e/shots/text-{name}.png", full_page=True, timeout=15000)
        except Exception as e:
            print("screenshot failed:", str(e)[:80])

    def no_money():
        if pg.locator('[data-testid="pay-price"]').count():
            raise SystemExit("a price confirmation appeared: " + pg.locator('[data-testid="pay-price"]').inner_text())

    status = wait_for({"script_ready", "script_approved", "images_approved", "shots_ready", "delivered"})
    print("status:", status)
    if status == "script_ready":
        for _ in range(30):  # the deploy may still be building
            if pg.locator('[data-testid="shot-text"]').count() and not pg.locator("select").count():
                break
            time.sleep(10); load()
        cards = pg.locator('[data-testid="shot-text"]')
        print("cards:", cards.count(), "| selects on the page:", pg.locator("select").count())
        for i in range(cards.count()):
            print(f"  {i + 1}:", cards.nth(i).input_value())
        cards.nth(0).fill(cards.nth(0).input_value().rstrip(".") + ".")
        pg.locator('[data-testid="script-save"]').click()
        pg.wait_for_timeout(4000)
        wait_for({"script_ready"})
        shot("script")
        pg.locator('[data-testid="script-approve"]').click()
        pg.wait_for_timeout(4000)
        status = wait_for({"script_approved"})
    if status == "script_approved":
        print("pictures:", pg.locator('[data-testid^="images-shot-"]').first.inner_text().replace("\n", " | ")[:200])
        print("draw buttons:", pg.locator('[data-testid="image-draw"]').count())
        shot("pictures")
        pg.locator('[data-testid="images-approve"]').click()
        pg.wait_for_timeout(3000)
        status = wait_for({"images_approved"})
    if status == "images_approved":
        for card in pg.locator('[data-testid^="shot-"]').all():
            btn = card.locator('[data-testid="shot-film"]')
            if btn.count():
                print("button:", btn.inner_text())
                btn.click()
                pg.wait_for_timeout(2500)
                no_money()
        wait_for({"images_approved"})
        shot("shots")
        while pg.locator('[data-testid="take-pick"]').count():
            pg.locator('[data-testid="take-pick"]').first.click()
            pg.wait_for_timeout(3000)
            pg.wait_for_load_state("networkidle")
        status = wait_for({"shots_ready"})
    if status == "shots_ready":
        shot("montage")
        pg.get_by_role("button", name="Assemble").first.click()
        pg.wait_for_timeout(3000)
        no_money()
        status = wait_for({"delivered"}, 600)
    print("final status:", status)
    shot("end")
    b.close()
