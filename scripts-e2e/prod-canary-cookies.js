// Production session for the E2E canary user (client "max", content slug operandi-canary).
// Credentials live outside the repo: ~/.config/operandi/dashboard-canary.{email,pass}.
// Usage: node scripts-e2e/prod-canary-cookies.js [out.json]  ->  cookies for dashboardln.operandiconsultancy.com
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..");
const { stringToBase64URL } = require(R + "/node_modules/@supabase/ssr/dist/main/utils/base64url");
const { createChunks } = require(R + "/node_modules/@supabase/ssr/dist/main/utils/chunker");
const env = {};
for (const l of fs.readFileSync(R + "/.env.local", "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const home = process.env.HOME + "/.config/operandi/";
(async () => {
  const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/token?grant_type=password", { method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: fs.readFileSync(home + "dashboard-canary.email", "utf8").trim(), password: fs.readFileSync(home + "dashboard-canary.pass", "utf8").trim() }) });
  const s = await r.json();
  if (!r.ok) { console.error("TOKEN ERROR", r.status, s.error_code || s.msg || s.error); process.exit(1); }
  const chunks = createChunks("sb-xepotlbqlwmriwievyvc-auth-token", "base64-" + stringToBase64URL(JSON.stringify(s)));
  const cookies = chunks.map(c => ({ name: c.name, value: c.value, domain: "dashboardln.operandiconsultancy.com", path: "/", httpOnly: false, secure: true, sameSite: "Lax" }));
  const OUT = process.argv[2] || "/tmp/e2e/prod-cookies.json";
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(cookies)); fs.chmodSync(OUT, 0o600);
  console.log("ok", cookies.length, "cookies");
})();
