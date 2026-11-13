import test from "node:test";
import assert from "node:assert/strict";
import {
  arrivedSince, fmtDate, fmtDateTime, isJustCreated, isOverdue, showCreated, NEW_WINDOW_MS, pickLocale, postStatus, postTab, sortForTab, statusLabel,
  type PostLike,
} from "./content-format";

const post = (o: Partial<PostLike> & { id?: string }): PostLike & { post_id: string } => ({
  post_type: "Image", text_status: "New", image_status: "New", published_at: null, scheduled_for: null, created_at: null, post_id: o.id ?? "x", ...o,
});

test("creation time is shown in Berlin time: 13:37 UTC on 13-11 is 14:37", () => {
  assert.equal(fmtDateTime("2026-11-13T13:37:41.770883+00:00", "de-DE"), "13.11.2026, 14:37");
  assert.equal(fmtDateTime("2026-11-13T13:37:41.770883+00:00", "en-GB"), "13/11/2026, 14:37");
});

test("summer time: 10:00 UTC in July is 12:00 in Berlin", () => {
  assert.equal(fmtDateTime("2026-07-01T10:00:00+00:00", "de-DE"), "01.07.2026, 12:00");
});

test("a day near midnight UTC lands on the Berlin calendar day", () => {
  assert.equal(fmtDate("2026-12-30T23:30:00+00:00", "de-DE"), "31.12.2026");
});

test("no or broken date gives a dash, never 'Invalid Date'", () => {
  assert.equal(fmtDateTime(null, "de-DE"), "—");
  assert.equal(fmtDateTime("nonsense", "de-DE"), "—");
});

test("the new mark: under 24 h yes, over 24 h no, unknown no, future no", () => {
  const now = Date.parse("2026-11-13T15:00:00Z");
  assert.equal(isJustCreated("2026-11-13T13:37:41Z", now), true);
  assert.equal(isJustCreated("2026-11-12T08:10:04Z", now), false); // row 207 at the meeting: 31 h old
  assert.equal(isJustCreated(new Date(now - NEW_WINDOW_MS + 1000).toISOString(), now), true);
  assert.equal(isJustCreated(new Date(now - NEW_WINDOW_MS).toISOString(), now), false);
  assert.equal(isJustCreated(null, now), false);
  assert.equal(isJustCreated("garbage", now), false);
  assert.equal(isJustCreated("2026-11-14T15:00:00Z", now), false);
});

test("locale: the client's own wins, then the browser's, then British English", () => {
  assert.equal(pickLocale("de-DE", "en-US,en;q=0.9"), "de-DE");
  assert.equal(pickLocale(null, "es-ES,es;q=0.9,en;q=0.8"), "es-ES");
  assert.equal(pickLocale(null, "*"), "en-GB");
  assert.equal(pickLocale(null, null), "en-GB");
  assert.equal(pickLocale("not a locale!!", "de"), "de");
});

test("the engine's 'New' is called 'To review'; the badge 'New' is only for just created", () => {
  assert.equal(statusLabel("New"), "To review");
  assert.equal(statusLabel("Approved"), "Approved");
});

test("state: text approved but image not approved is still under review", () => {
  assert.equal(postStatus(post({ text_status: "Approved", image_status: "New" })), "Under review");
  assert.equal(postStatus(post({ text_status: "Approved", image_status: "Approved" })), "Approved");
  assert.equal(postStatus(post({ post_type: "Text", text_status: "Approved" })), "Approved");
  assert.equal(postStatus(post({ text_status: "Approved", published_at: "2026-11-01T10:00:00Z" })), "Published");
});

test("tabs", () => {
  assert.equal(postTab(post({})), "review");
  assert.equal(postTab(post({ text_status: "Under review" })), "review");
  assert.equal(postTab(post({ text_status: "Approved", image_status: "Approved" })), "scheduled");
  assert.equal(postTab(post({ text_status: "Suspended" })), "suspended");
  assert.equal(postTab(post({ published_at: "2026-11-01T10:00:00Z" })), "published");
});

test("meeting of 13-11: the post created today (208) comes before the one scheduled later (207) in 'to review'", () => {
  const p207 = post({ id: "207", created_at: "2026-11-12T08:10:04Z", scheduled_for: "2027-01-01T10:00:00Z" });
  const p208 = post({ id: "208", created_at: "2026-11-13T13:37:41Z", scheduled_for: "2026-12-30T10:00:00Z" });
  assert.deepEqual(sortForTab([p207, p208], "review").map(p => p.post_id), ["208", "207"]);
});

test("review: posts without a creation time go last, ties fall back to the schedule", () => {
  const a = post({ id: "a", created_at: null, scheduled_for: "2026-12-01T10:00:00Z" });
  const b = post({ id: "b", created_at: "2026-11-01T10:00:00Z" });
  const c = post({ id: "c", created_at: null, scheduled_for: "2027-01-01T10:00:00Z" });
  assert.deepEqual(sortForTab([a, b, c], "review").map(p => p.post_id), ["b", "c", "a"]);
});

test("scheduled: soonest first; published: latest first", () => {
  const a = post({ id: "a", scheduled_for: "2026-12-05T10:00:00Z", published_at: "2026-10-01T10:00:00Z" });
  const b = post({ id: "b", scheduled_for: "2026-11-20T10:00:00Z", published_at: "2026-10-09T10:00:00Z" });
  assert.deepEqual(sortForTab([a, b], "scheduled").map(p => p.post_id), ["b", "a"]);
  assert.deepEqual(sortForTab([a, b], "published").map(p => p.post_id), ["b", "a"]);
});

test("sorting does not touch the input", () => {
  const list = [post({ id: "1", created_at: "2026-11-01T00:00:00Z" }), post({ id: "2", created_at: "2026-11-02T00:00:00Z" })];
  sortForTab(list, "review");
  assert.equal(list[0].post_id, "1");
});

test("posts that arrived after pressing Generate: only the unknown ones, oldest first, no more than asked", () => {
  const rows = [
    { post_id: "old", created_at: "2026-11-10T00:00:00Z" },
    { post_id: "n2", created_at: "2026-11-13T13:38:00Z" },
    { post_id: "n1", created_at: "2026-11-13T13:37:00Z" },
    { post_id: "n3", created_at: "2026-11-13T13:39:00Z" },
  ];
  assert.deepEqual(arrivedSince(rows, ["old"], 2).map(p => p.post_id), ["n1", "n2"]);
  assert.deepEqual(arrivedSince(rows, ["old", "n1", "n2", "n3"], 3), []);
  assert.deepEqual(arrivedSince(rows, ["old"], 0), []);
});

test("the new mark: a creation stamp a little ahead of the clock still counts (slow clock)", () => {
  const now = Date.parse("2026-11-13T15:00:00Z");
  assert.equal(isJustCreated("2026-11-13T15:02:00Z", now), true);
  assert.equal(isJustCreated("2026-11-13T15:10:00Z", now), false);
});

test("overdue: only when not out and the date has passed", () => {
  const now = Date.parse("2026-11-13T15:00:00Z");
  assert.equal(isOverdue("2026-11-13T14:00:00Z", null, now), true);
  assert.equal(isOverdue("2026-11-13T16:00:00Z", null, now), false);
  assert.equal(isOverdue("2026-11-13T14:00:00Z", "2026-11-13T14:01:00Z", now), false);
  assert.equal(isOverdue(null, null, now), false);
});

test("created is hidden on a published post when it is later than the publication", () => {
  assert.equal(showCreated({ created_at: "2026-11-12T10:00:00Z", published_at: "2026-11-01T10:00:00Z" }), false);
  assert.equal(showCreated({ created_at: "2026-10-30T10:00:00Z", published_at: "2026-11-01T10:00:00Z" }), true);
  assert.equal(showCreated({ created_at: "2026-11-12T10:00:00Z", published_at: null }), true);
  assert.equal(showCreated({ created_at: null, published_at: "2026-11-01T10:00:00Z" }), true);
});
