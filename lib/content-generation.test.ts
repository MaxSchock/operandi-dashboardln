import test from "node:test";
import assert from "node:assert/strict";
import { GenerationFollow, shortfall, shortfallMessage } from "./content-generation";

const row = (id: string, created: string) => ({
  post_id: id, created_at: created, text_status: "New", image_status: "New", post_type: "Image", published_at: null, scheduled_for: null,
});
const OLD = row("old", "2026-11-10T10:00:00Z");

test("complete: one jump at the first new post, none for the rest", () => {
  const f = new GenerationFollow(); f.press();
  const run = { n: 3, known: ["old"] };
  let rows = [OLD];
  assert.deepEqual(f.step(rows, run), { fresh: [], jumpTo: null });
  rows = [OLD, row("a", "2026-11-13T10:01:00Z")];
  assert.deepEqual(f.step(rows, run), { fresh: ["a"], jumpTo: "a" });
  rows = [...rows, row("b", "2026-11-13T10:02:00Z")];
  assert.deepEqual(f.step(rows, run), { fresh: ["a", "b"], jumpTo: null });
  rows = [...rows, row("c", "2026-11-13T10:03:00Z")];
  assert.deepEqual(f.step(rows, run), { fresh: ["a", "b", "c"], jumpTo: null });
  assert.equal(shortfall(rows, run), null);
});

test("re-running step with new arrays of the same rows changes nothing", () => {
  const f = new GenerationFollow(); f.press();
  const run = { n: 1, known: ["old"] };
  f.step([OLD, row("a", "2026-11-13T10:01:00Z")], run);
  for (let i = 0; i < 5; i++) assert.deepEqual(f.step([OLD, row("a", "2026-11-13T10:01:00Z")], run), { fresh: ["a"], jumpTo: null });
});

test("a post that was looked at is not highlighted again, and does not bring the jump back", () => {
  const f = new GenerationFollow(); f.press();
  const run = { n: 2, known: ["old"] };
  const rows = [OLD, row("a", "2026-11-13T10:01:00Z")];
  f.step(rows, run);
  assert.deepEqual(f.markSeen("a"), []);
  assert.deepEqual(f.step([...rows], run), { fresh: [], jumpTo: null });   // reload
  assert.deepEqual(f.step([...rows, row("b", "2026-11-13T10:02:00Z")], run), { fresh: ["b"], jumpTo: null }); // second post: highlight, no jump
});

test("someone who moved on their own is not taken anywhere, but the post is still highlighted", () => {
  const f = new GenerationFollow(); f.press();
  f.userMoved();
  const run = { n: 1, known: ["old"] };
  assert.deepEqual(f.step([OLD, row("a", "2026-11-13T10:01:00Z")], run), { fresh: ["a"], jumpTo: null });
});

test("a new press starts a new run: the first post of that run jumps again", () => {
  const f = new GenerationFollow(); f.press();
  const r1 = { n: 1, known: ["old"] };
  const rows1 = [OLD, row("a", "2026-11-13T10:01:00Z")];
  assert.equal(f.step(rows1, r1).jumpTo, "a");
  f.markSeen("a");
  f.press();
  const r2 = { n: 1, known: ["old", "a"] };
  assert.equal(f.step(rows1, r2).jumpTo, null);
  assert.equal(f.step([...rows1, row("b", "2026-11-13T11:00:00Z")], r2).jumpTo, "b");
});

test("partial: no late jump once the wait is over, and the shortfall is said", () => {
  const f = new GenerationFollow(); f.press();
  const run = { n: 3, known: ["old"] };
  const rows = [OLD, row("a", "2026-11-13T10:01:00Z")];
  assert.equal(f.step(rows, run).jumpTo, "a");
  // wait over: the run is gone, nothing jumps
  assert.deepEqual(f.step(rows, undefined), { fresh: ["a"], jumpTo: null });
  const s = shortfall(rows, run);
  assert.deepEqual(s, { asked: 3, arrived: 1 });
  assert.match(shortfallMessage(s!), /^1 of 3 posts arrived in 20 minutes\./);
});

test("none arrived: no jump at all and the message says nothing was written", () => {
  const f = new GenerationFollow(); f.press();
  const run = { n: 2, known: ["old"] };
  assert.deepEqual(f.step([OLD], run), { fresh: [], jumpTo: null });
  assert.deepEqual(f.step([OLD], undefined), { fresh: [], jumpTo: null });
  const s = shortfall([OLD], run)!;
  assert.deepEqual(s, { asked: 2, arrived: 0 });
  assert.match(shortfallMessage(s), /^0 of 2 posts arrived in 20 minutes\. Nothing was written\./);
});
