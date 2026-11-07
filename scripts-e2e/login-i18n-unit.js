// Unit check of the sign-in language choice and texts. Run: node scripts-e2e/login-i18n-unit.js
// Compiles lib/login-i18n.ts with the repo's TypeScript and runs it in memory.
const fs = require("fs");
const path = require("path");
const ts = require("../node_modules/typescript");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "login-i18n.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const { pickLang, LOGIN_TEXTS } = mod.exports;

assert.strictEqual(pickLang(null), "en");
assert.strictEqual(pickLang(""), "en");
assert.strictEqual(pickLang("de-DE,de;q=0.9,en;q=0.8"), "de");
assert.strictEqual(pickLang("fr-BE,fr;q=0.9"), "fr");
assert.strictEqual(pickLang("nl-BE,nl;q=0.9,fr;q=0.8,en;q=0.7"), "fr");
assert.strictEqual(pickLang("es-ES"), "es");
assert.strictEqual(pickLang("ja,zh;q=0.5"), "en");
assert.strictEqual(pickLang("en;q=0.5,de;q=0.9"), "de");
assert.strictEqual(pickLang("de;q=0,es"), "es");

const keys = Object.keys(LOGIN_TEXTS.en).sort();
for (const lang of ["de", "fr", "es"]) {
  assert.deepStrictEqual(Object.keys(LOGIN_TEXTS[lang]).sort(), keys, `${lang} has the same keys as en`);
  for (const k of keys) assert.ok(LOGIN_TEXTS[lang][k].trim(), `${lang}.${k} is not empty`);
}
for (const lang of Object.keys(LOGIN_TEXTS)) {
  for (const [k, v] of Object.entries(LOGIN_TEXTS[lang])) {
    assert.ok(!v.includes("—"), `${lang}.${k} has no long dash`);
  }
}
assert.strictEqual(LOGIN_TEXTS.de.forgotPassword, "Passwort vergessen?");
console.log("login-i18n-unit: ok");

const { safeNext } = mod.exports;
assert.strictEqual(safeNext(null), "/dashboard");
assert.strictEqual(safeNext("/content"), "/content");
assert.strictEqual(safeNext("https://evil.test"), "/dashboard");
assert.strictEqual(safeNext("//evil.test"), "/dashboard");
assert.strictEqual(safeNext("/\\evil.test"), "/dashboard");
assert.strictEqual(safeNext("javascript:alert(1)"), "/dashboard");
console.log("safeNext: ok");
