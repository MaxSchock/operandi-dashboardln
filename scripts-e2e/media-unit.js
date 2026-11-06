// Unit check of lib/media.ts (what a post card draws). Run: node scripts-e2e/media-unit.js
const ts = require("typescript"), fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "../lib/media.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: "es2020" } }).outputText;
const m = { exports: {} }; new Function("module", "exports", js)(m, m.exports);
const { mediaOf, looksLikeVideo } = m.exports;
const EN = "https://sss3.figura-studio.com/operandi-video/linkedin-max/2026-11-09-how-to-use-linus-en.mp4";
const row = (o) => ({ post_type: "Image", video_url: null, image_url_imgbb: null, image_url_source: null, ...o });
// the two real rows of 06-11-2026: file in both image_url_imgbb and video_url
assert.deepStrictEqual(mediaOf(row({ post_type: "Video", video_url: EN, image_url_imgbb: EN })), { kind: "video", src: EN });
// video file only in the image column, no video_url
assert.deepStrictEqual(mediaOf(row({ post_type: "Video", image_url_imgbb: EN })), { kind: "video", src: EN });
assert.strictEqual(mediaOf(row({ image_url_imgbb: EN })).kind, "video");
assert.strictEqual(mediaOf(row({ image_url_imgbb: EN + "?X-Amz=1" })).kind, "video");
// image post unchanged, fallback kept
assert.deepStrictEqual(mediaOf(row({ image_url_imgbb: "https://i.ibb.co/a.png", image_url_source: "https://fal/a.png" })),
  { kind: "image", src: "https://i.ibb.co/a.png", fallback: "https://fal/a.png" });
assert.deepStrictEqual(mediaOf(row({ image_url_source: "https://fal/a.png" })), { kind: "image", src: "https://fal/a.png", fallback: null });
// nothing: no media, never an empty image
assert.deepStrictEqual(mediaOf(row({})), { kind: "none" });
assert.deepStrictEqual(mediaOf(row({ image_url_imgbb: "  ", video_url: "" })), { kind: "none" });
assert.deepStrictEqual(mediaOf(row({ post_type: "Text" })), { kind: "none" });
assert.ok(!looksLikeVideo("https://x/a.png") && looksLikeVideo("https://x/a.MOV"));
console.log("media-unit ok");
