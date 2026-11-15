import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFreeText, normalizeNewlines } from "./text-newlines";

// What a browser puts on the wire for a textarea with 8 line breaks (multipart, CRLF per break).
const typed = Array.from({ length: 9 }, (_, i) => `line ${i}`).join("\r\n");

async function throughFormData(value: string): Promise<string> {
  const fd = new FormData();
  fd.set("text", value);
  const req = new Request("http://x/", { method: "POST", body: fd });
  return String((await req.formData()).get("text"));
}

test("cause: the form body carries the CRs untouched to the server", async () => {
  const got = await throughFormData(typed);
  assert.equal(got.split("\r").length - 1, 8);
});

test("a text of 8 line breaks leaves with no CR", async () => {
  const got = (normalizeFreeText({ text: await throughFormData(typed) }) as { text: string }).text;
  assert.equal(got.includes("\r"), false);
  assert.equal(got.split("\n").length - 1, 8);
});

test("lone CR and CRLF both become LF, LF stays, blank lines stay", () => {
  assert.equal(normalizeNewlines("a\r\nb\rc\nd\r\n\r\ne"), "a\nb\nc\nd\n\ne");
});

test("free-text fields are cleaned, other fields untouched", () => {
  const out = normalizeFreeText({ text: "a\r\nb", notes: "c\r\nd", post_id: "p\r1", date: "2026-11-15" });
  assert.deepEqual(out, { text: "a\nb", notes: "c\nd", post_id: "p\r1", date: "2026-11-15" });
});
