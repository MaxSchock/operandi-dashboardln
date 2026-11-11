// Unit check of lib/image-review.ts (what a post card says about its picture's check).
// Run: node scripts-e2e/image-review-unit.js
const ts = require("typescript"), fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "../lib/image-review.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "es2020" } }).outputText;
const m = { exports: {} }; new Function("module", "exports", "require", js)(m, m.exports, require);
const { imageParked, imageCheck, currentReview, imageNotesShown } = m.exports;
const IMG = "https://i.ibb.co/post.png";
const row = (o) => ({ image_status: "New", image_url_imgbb: IMG, image_url_source: "https://fal/x.png", ...o });
const v = (verdict, o = {}) => ({ stage: "prepare", verdict, issues: [], reason: "", model: "m", at: "2026-11-10T10:00:00+00:00", image_url: IMG, ...o });

// parked: rejected by the reviewer, engine note -> not "being drawn"
assert.ok(imageParked(row({ image_status: "In progress", image_notes: "auto: pipe ends in the air" })));
assert.ok(imageParked(row({ image_status: "In progress", image_notes: "  AUTO: x" })));
// regenerating on a person's request: the note is the person's -> still being drawn
assert.ok(!imageParked(row({ image_status: "In progress", image_notes: "keep the boiler" })));
assert.ok(!imageParked(row({ image_status: "In progress", image_notes: null })));
assert.ok(!imageParked(row({ image_status: "New", image_notes: "auto: x" })));
// before the view migration the fields do not exist: nothing changes
assert.ok(!imageParked(row({ image_status: "In progress" })));
assert.strictEqual(imageCheck(row({})), null);

// fail -> red with the reasons
const fail = imageCheck(row({ image_review: v("fail", { issues: [{ description: "boiler with no flue" }] }) }));
assert.deepStrictEqual(fail, { tone: "red", label: "flagged by the image reviewer", issues: ["boiler with no flue"] });
// parked without a stored verdict -> red as well
assert.strictEqual(imageCheck(row({ image_status: "In progress", image_notes: "auto: x" })).tone, "red");
// unreviewed -> amber, never shown as fine
assert.strictEqual(imageCheck(row({ image_review: v("unreviewed", { reason: "vision HTTP 529" }) })).tone, "amber");
// pass with minor remarks (HNT 23-11) -> shown, quiet
assert.deepStrictEqual(imageCheck(row({ image_review: v("pass", { issues: [{ description: "second boiler with no pipes" }] }) })).issues,
  ["second boiler with no pipes"]);
// clean pass -> nothing
assert.strictEqual(imageCheck(row({ image_review: v("pass") })), null);
// verdict of another picture (uploaded by hand afterwards) -> ignored
assert.strictEqual(currentReview(row({ image_url_imgbb: "https://i.ibb.co/manual.png", image_url_source: null, image_review: v("fail") })), null);
assert.strictEqual(imageCheck(row({ image_url_imgbb: "https://i.ibb.co/manual.png", image_url_source: null, image_review: v("fail") })), null);
// verdict on the fal file is the same picture
assert.ok(currentReview(row({ image_review: v("fail", { image_url: "https://fal/x.png" }) })));
// junk in the column does not break the card
assert.strictEqual(imageCheck(row({ image_review: "x" })), null);
assert.strictEqual(imageCheck(row({ image_review: {} })), null);
// a person wrote under the engine's line: the daemon redraws, the card must say so
assert.ok(!imageParked(row({ image_status: "In progress", image_notes: "auto: the reviewer flagged this image: x\nkeep the boiler" })));
assert.ok(imageParked(row({ image_status: "In progress", image_notes: "auto: a\n\u26a0 b\nsage_flagged: c" })));
// approved or published: no red badge, engine lines hidden, person's lines kept
assert.strictEqual(imageCheck(row({ image_status: "Approved", image_review: v("fail") })), null);
assert.strictEqual(imageCheck(row({ image_status: "Published", image_review: v("unreviewed") })), null);
assert.strictEqual(imageNotesShown(row({ image_status: "Approved", image_notes: "auto: x\nwarmer light" })), "warmer light");
// picture replaced by hand: the old engine note goes, the verdict is ignored
assert.strictEqual(imageNotesShown(row({ image_url_imgbb: "https://i.ibb.co/manual.png", image_url_source: null,
  image_notes: "auto: AI artifacts detected", image_review: v("fail") })), "");
// same picture: the note stays
assert.strictEqual(imageNotesShown(row({ image_notes: "auto: x", image_review: v("fail") })), "auto: x");
// issues that are not a list do not throw
assert.deepStrictEqual(imageCheck(row({ image_review: v("fail", { issues: "x" }) })).issues, []);
console.log("image-review-unit ok");
