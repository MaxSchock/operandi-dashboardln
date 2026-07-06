// Mint a Supabase session for the ephemeral E2E fixture and emit the exact
// @supabase/ssr auth cookies (base64url + chunked), reusing the library's own
// encoders so the format is guaranteed to match what middleware/server read.
const fs = require("fs");
const path = require("path");
const { stringToBase64URL } = require("@supabase/ssr/dist/main/utils/base64url");
const { createChunks } = require("@supabase/ssr/dist/main/utils/chunker");

const PROJECT_REF = "xepotlbqlwmriwievyvc";
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD }),
  });
  const s = await resp.json();
  if (!resp.ok) { console.error("TOKEN ERROR", resp.status, JSON.stringify(s)); process.exit(1); }

  // The value gotrue-js persists is JSON.stringify(session). Store the token
  // response verbatim (access_token, refresh_token, expires_at, user, ...).
  const value = "base64-" + stringToBase64URL(JSON.stringify(s));
  const chunks = createChunks(STORAGE_KEY, value);
  const cookies = chunks.map((c) => ({
    name: c.name, value: c.value, domain: "localhost", path: "/",
    httpOnly: false, secure: false, sameSite: "Lax",
  }));
  fs.writeFileSync("/tmp/e2e/cookies.json", JSON.stringify(cookies, null, 2));
  console.error(`OK: ${cookies.length} cookie(s): ${cookies.map((c) => `${c.name}(${c.value.length})`).join(", ")}`);
}
main();
