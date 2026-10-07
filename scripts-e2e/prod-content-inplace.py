"""Content page as the E2E canary: a free action (saving the date a post already
has) must update its card without loading the page again.
Usage: python3 scripts-e2e/prod-content-inplace.py   (cookies first: node scripts-e2e/prod-canary-cookies.js)
"""
import sys, json, os, time
sys.path.insert(0, os.path.expanduser("~/.config"))
from playwright_exe import chromium_exe
from playwright.sync_api import sync_playwright

BASE = "https://dashboardln.operandiconsultancy.com"
cookies = json.load(open("/tmp/e2e/prod-cookies.json"))
os.makedirs("/tmp/e2e/shots", exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=chromium_exe(), args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1280, "height": 1600})
    ctx.add_cookies(cookies)
    pg = ctx.new_page()
    # The route exists only once the new build is live.
    for _ in range(40):
        r = ctx.request.get(BASE + "/api/content")
        if r.status == 200 and "posts" in r.text()[:400000]:
            break
        time.sleep(10)
    else:
        print("GET /api/content never answered 200"); sys.exit(1)
    d = r.json()
    print("api: posts", len(d["posts"]), "drafts", len(d["drafts"]), "isAdmin", d["isAdmin"], "ownSlug", d["ownSlug"])
    errors, loads, posts_seen = [], [], []
    pg.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append("pageerror " + str(e)[:200]))
    pg.on("load", lambda _: loads.append(time.time()))
    pg.on("request", lambda q: posts_seen.append((q.method, q.url.replace(BASE, ""), q.resource_type)) if q.method == "POST" or "/api/content" in q.url else None)
    pg.goto(BASE + "/content", wait_until="networkidle", timeout=60000)
    cards = pg.locator('[data-testid="post-card"]')
    print("cards", cards.count(), "forms with action attr", pg.locator("form[action]").count())
    # A post not approved yet: saving the date it already has changes nothing.
    target = None
    for i in range(cards.count()):
        c = cards.nth(i)
        if c.locator('[data-testid="post-save-date"]').count() and "New" in c.inner_text()[:40]:
            target = c; break
    if target is None:
        print("no unapproved post to try on"); sys.exit(1)
    pid = target.get_attribute("data-post")
    before = target.locator('[data-testid="post-when"]').inner_text()
    pg.evaluate("window.__mark = 1")
    target.locator('[data-testid="post-save-date"]').click()
    target.locator('[data-testid="post-done"], [data-testid="post-error"]').first.wait_for(timeout=45000)
    print("post", pid, "| when", before, "->", target.locator('[data-testid="post-when"]').inner_text())
    print("outcome:", target.locator('[data-testid="post-done"], [data-testid="post-error"]').first.inner_text())
    print("same document (no reload):", pg.evaluate("window.__mark === 1"), "| load events", len(loads), "| url", pg.url.replace(BASE, ""))
    print("requests:", [x for x in posts_seen])
    print("console errors:", errors[:5])
    pg.screenshot(path="/tmp/e2e/shots/prod_content_inplace.png", full_page=False)
    b.close()
