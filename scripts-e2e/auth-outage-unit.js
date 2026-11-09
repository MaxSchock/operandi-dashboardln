// Unit check of isAuthOutage against the real auth-js error classes. Run: node scripts-e2e/auth-outage-unit.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const ts = require("../node_modules/typescript");
const errs = require("../node_modules/@supabase/auth-js/dist/main/lib/errors.js");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "auth-outage.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const { isAuthOutage } = mod.exports;

// Outages: fetch failed, gateway errors, server errors.
assert.strictEqual(isAuthOutage(new errs.AuthRetryableFetchError("fetch failed", 0)), true);
assert.strictEqual(isAuthOutage(new errs.AuthRetryableFetchError("bad gateway", 502)), true);
assert.strictEqual(isAuthOutage(new errs.AuthApiError("internal", 500, "unexpected_failure")), true);
assert.strictEqual(isAuthOutage(new errs.AuthUnknownError("boom", {})), false); // no status: treated as logged out
// Real "no valid session": must still go to /login.
assert.strictEqual(isAuthOutage(null), false);
assert.strictEqual(isAuthOutage(undefined), false);
assert.strictEqual(isAuthOutage(new errs.AuthSessionMissingError()), false);
assert.strictEqual(isAuthOutage(new errs.AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found")), false);
assert.strictEqual(isAuthOutage(new errs.AuthApiError("invalid JWT", 403, "bad_jwt")), false);
console.log("auth-outage-unit: ok");
