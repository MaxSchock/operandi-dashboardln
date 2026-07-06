// Mobile E2E: load each page at an iPhone-class viewport, screenshot, and probe
// whether primary navigation is reachable + whether anything overflows the width.
const fs = require("fs");
const { chromium, devices } = require("playwright");

const BASE = "http://localhost:3100";
const OUT = "/tmp/e2e/shots";
const iPhone = devices["iPhone 12"]; // 390x844, mobile, touch

const PAGES = [
  ["login", "/login", false],
  ["dashboard", "/dashboard", true],
  ["leads", "/leads", true],
  ["engagement", "/engagement", true],
  ["content", "/content", true],
  ["videos", "/videos", true],
  ["activity", "/activity", true],
  ["templates", "/templates", true],
  ["admin", "/admin", true],
  ["admin-health", "/admin/health", true],
];

(async () => {
  const cookies = JSON.parse(fs.readFileSync("/tmp/e2e/cookies.json", "utf8"));
  const browser = await chromium.launch();
  const report = [];

  for (const [name, route, needsAuth] of PAGES) {
    const context = await browser.newContext({ ...iPhone });
    if (needsAuth) await context.addCookies(cookies);
    const page = await context.newPage();
    let status = null;
    try {
      const resp = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 45000 });
      status = resp ? resp.status() : null;
    } catch (e) {
      report.push({ name, route, error: String(e).split("\n")[0] });
      await context.close();
      continue;
    }
    await page.waitForTimeout(2500);
    // Freeze animations/auto-refresh so screenshots settle.
    await page.addStyleTag({ content: "*{animation:none!important;transition:none!important;caret-color:transparent!important}" }).catch(() => {});

    const probe = await page.evaluate(() => {
      const vw = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      // Is any nav link visible in the viewport right now?
      const navLinks = Array.from(document.querySelectorAll("a[href^='/']"));
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"
          && r.bottom > 0 && r.top < window.innerHeight;
      };
      const visibleNav = navLinks.filter((a) => /\/(dashboard|leads|engagement|content|activity|templates|admin)/.test(a.getAttribute("href")) && isVisible(a));
      // Any hamburger/menu button?
      const btns = Array.from(document.querySelectorAll("button, [role=button], [aria-label]"));
      const menuButton = btns.find((b) => /menu|nav|hamburger/i.test((b.getAttribute("aria-label") || "") + " " + b.className + " " + b.id));
      // Widest element overflowing viewport
      let worst = null;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 2 && r.width <= docW) {
          if (!worst || r.right > worst.right) {
            worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 60) };
          }
        }
      }
      return {
        vw, docW, horizontalOverflow: docW > vw + 2,
        visibleNavCount: visibleNav.length,
        hasMenuButton: !!menuButton,
        worstOverflow: worst,
      };
    });

    const file = `${OUT}/${name}.png`;
    let shotOk = "full";
    try {
      await page.screenshot({ path: file, fullPage: true, animations: "disabled", timeout: 15000 });
    } catch {
      try {
        await page.screenshot({ path: file, fullPage: false, animations: "disabled", timeout: 10000 });
        shotOk = "viewport-only";
      } catch (e2) {
        shotOk = "failed:" + String(e2).split("\n")[0];
      }
    }
    report.push({ name, route, status, ...probe, shot: shotOk, screenshot: file });
    await context.close();
  }

  // Drawer test: open the hamburger on /dashboard and screenshot the open menu.
  {
    const context = await browser.newContext({ ...iPhone });
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    const btn = page.getByRole("button", { name: /open menu/i });
    const hasBtn = await btn.count();
    let drawerLinks = 0;
    if (hasBtn) {
      await btn.first().click();
      await page.waitForTimeout(600);
      drawerLinks = await page.locator("nav a[href^='/']").count();
      await page.screenshot({ path: `${OUT}/drawer-open.png`, animations: "disabled", timeout: 15000 });
    }
    report.push({ name: "drawer", hamburgerButton: !!hasBtn, drawerLinks });
    console.log(`drawer         hamburger=${!!hasBtn} linksInDrawer=${drawerLinks}`);
    await context.close();
  }

  await browser.close();
  fs.writeFileSync("/tmp/e2e/report.json", JSON.stringify(report, null, 2));
  for (const r of report) {
    if (r.error) { console.log(`FAIL ${r.name}: ${r.error}`); continue; }
    console.log(
      `${r.name.padEnd(14)} http=${r.status} nav=${r.visibleNavCount} menuBtn=${r.hasMenuButton} ` +
      `overflow=${r.horizontalOverflow}${r.worstOverflow ? ` (${r.worstOverflow.tag}.${r.worstOverflow.cls} -> ${r.worstOverflow.right}px/${r.vw})` : ""}`
    );
  }
})();
