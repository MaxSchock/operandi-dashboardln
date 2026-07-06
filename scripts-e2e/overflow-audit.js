// Per-page mobile overflow audit. For each route: find elements whose box
// extends past the viewport and classify them as LEAK (real responsive bug) vs
// OK-SCROLL (inside an intended overflow-x:auto/scroll container).
const fs = require("fs");
const { chromium, devices } = require("playwright");

const BASE = "http://localhost:3100";
const OUT = "/tmp/e2e/shots";
const iPhone = devices["iPhone 12"];

const PAGES = [
  ["dashboard", "/dashboard"],
  ["leads", "/leads"],
  ["engagement", "/engagement"],
  ["content", "/content"],
  ["activity", "/activity"],
  ["templates", "/templates"],
  ["admin", "/admin"],
  ["admin-health", "/admin/health"],
  ["admin-bandit", "/admin/bandit"],
];

(async () => {
  const cookies = JSON.parse(fs.readFileSync("/tmp/e2e/cookies.json", "utf8"));
  const browser = await chromium.launch();
  const out = [];

  for (const [name, route] of PAGES) {
    const context = await browser.newContext({ ...iPhone });
    await context.addCookies(cookies);
    const page = await context.newPage();
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
      out.push({ name, error: String(e).split("\n")[0] });
      await context.close();
      continue;
    }
    await page.waitForTimeout(2500);
    await page.addStyleTag({ content: "*{animation:none!important;transition:none!important}" }).catch(() => {});

    const res = await page.evaluate(() => {
      const vw = window.innerWidth;
      const leaks = [];
      const okScroll = [];
      const seen = new Set();
      const desc = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".") : ""}`;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right <= vw + 1) continue;
        // climb: inside an intended horizontal scroll container?
        let scrollable = false;
        let p = el.parentElement;
        while (p) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll") { scrollable = true; break; }
          p = p.parentElement;
        }
        const key = desc(el);
        if (seen.has(key)) continue;
        seen.add(key);
        const rec = { sel: key, right: Math.round(r.right), width: Math.round(r.width) };
        (scrollable ? okScroll : leaks).push(rec);
      }
      leaks.sort((a, b) => b.right - a.right);
      okScroll.sort((a, b) => b.right - a.right);
      return { vw, docOverflow: document.documentElement.scrollWidth > vw + 1, leaks: leaks.slice(0, 10), okScroll: okScroll.slice(0, 4) };
    });

    await page.screenshot({ path: `${OUT}/audit-${name}.png`, fullPage: true, animations: "disabled", timeout: 20000 }).catch(() => {});
    out.push({ name, route, ...res });
    await context.close();
  }

  await browser.close();
  fs.writeFileSync("/tmp/e2e/overflow.json", JSON.stringify(out, null, 2));
  for (const r of out) {
    if (r.error) { console.log(`${r.name}: ERROR ${r.error}`); continue; }
    console.log(`\n== ${r.name} (vw=${r.vw}, docOverflow=${r.docOverflow}) ==`);
    if (!r.leaks.length) console.log("  no leaks");
    for (const l of r.leaks) console.log(`  LEAK  ${l.right}px  ${l.sel}`);
    for (const l of r.okScroll) console.log(`  ok-scroll ${l.right}px  ${l.sel}`);
  }
})();
