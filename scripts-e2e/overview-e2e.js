// E2E for the Overview view selection: content-only clients (and admins scoped
// to one) get the content overview; outreach clients and unscoped admins keep
// the lead funnel. Run with the server on :3100 and cookies minted by
// auth-cookies.js into /tmp/e2e/cookies-<who>.json.
const fs = require("fs");
const { chromium } = require("playwright");

const BASE = "http://localhost:3100";
const OUT = "/tmp/e2e/overview-shots";

const scopeCookie = (slug) => ({
  name: "operandi_scope", value: slug, domain: "localhost", path: "/",
  httpOnly: false, secure: false, sameSite: "Lax",
});

// [name, cookieFile, extraCookies, path, checks]
// check = [description, mustBePresent, needle]
const SCENARIOS = [
  ["client-madeleine", "cookies-madeleine.json", [], "/dashboard", [
    ["content view rendered", true, "Post performance"],
    ["ICP KPI present", true, "ICP engagers"],
    ["review queue present", true, "Waiting for your review"],
    ["no outreach funnel", false, "Pipeline funnel"],
    ["range label", true, "Window: 30 days"],
  ]],
  ["admin-scope-madeleine", "cookies-admin.json", [scopeCookie("madeleine")], "/dashboard", [
    ["content view rendered", true, "Post performance"],
    ["ICP KPI present", true, "ICP engagers"],
    ["no outreach funnel", false, "Pipeline funnel"],
  ]],
  ["admin-scope-all", "cookies-admin.json", [], "/dashboard", [
    ["outreach funnel rendered", true, "Pipeline funnel"],
    ["no content view", false, "Post performance"],
  ]],
  ["admin-scope-zayd", "cookies-admin.json", [scopeCookie("zayd")], "/dashboard", [
    ["outreach funnel rendered (has_outreach client)", true, "Pipeline funnel"],
    ["no content view", false, "Post performance"],
  ]],
  ["client-madeleine-7d", "cookies-madeleine.json", [], "/dashboard?range=7d", [
    ["range applied", true, "Window: 7 days"],
    ["content view rendered", true, "Post performance"],
  ]],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let failures = 0;

  for (const [name, cookieFile, extra, route, checks] of SCENARIOS) {
    const context = await browser.newContext();
    const cookies = JSON.parse(fs.readFileSync(`/tmp/e2e/${cookieFile}`, "utf8"));
    await context.addCookies([...cookies, ...extra]);
    const page = await context.newPage();
    const resp = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
    const status = resp ? resp.status() : null;
    const body = (await page.textContent("body")) ?? "";
    console.log(`\n== ${name} (${route}) HTTP ${status}`);
    if (status !== 200) failures++;
    for (const [label, mustBePresent, needle] of checks) {
      const found = body.includes(needle);
      const ok = found === mustBePresent;
      if (!ok) failures++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} [${mustBePresent ? "expects" : "rejects"} "${needle}"]`);
    }
    // Surface the KPI strip so the run log shows real numbers, not just booleans.
    const kpis = await page.$$eval("section.grid .font-display.text-3xl", els => els.map(e => e.textContent));
    console.log(`  KPIs: ${JSON.stringify(kpis)}`);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    await context.close();
  }

  await browser.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
