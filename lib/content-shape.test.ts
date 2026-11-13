import test from "node:test";
import assert from "node:assert/strict";
import { shapeContent, type ShapeInput } from "./content-shape";
import type { AnalyticsRow, CalendarRow, CommentDraftRow } from "./content-types";

const post = (slug: string, outreach: string, id: string): CalendarRow => ({
  content_slug: slug, content_name: slug, outreach_slug: outreach, post_id: id, sheet_row: 1, post_type: "Image", text_content: "t",
  text_status: "New", image_status: "New", topic: null, pain_id: null, pain_label: null, image_url_imgbb: null, image_url_source: null,
  scheduled_for: null, published_at: null, linkedin_url: null, linkedin_deleted_at: null,
  engagement: { reactions: 3, comments: 1, reposts: 0, impressions: 100, score: 7.5, audience: { icp: 2, total: 5, icp_pct: 0.4 } },
});
const an = (slug: string, outreach: string): AnalyticsRow => ({
  content_slug: slug, content_name: slug, outreach_slug: outreach, avg_icp_pct: "0.4", topic_icp_fit: { a: 0.5 }, topic_weights: { a: 1 },
  first_pass_rate_30d: "0.8", regression_alert: { since: "2026-11-01", ma_short: 1, ma_long: 2, ratio: 0.5 },
  distilled_rules: ["r"], hard_negatives: ["h"], exemplar_posts: [{ id: "x", text: "t", topic: "a", score: 1 }], computed_at: "2026-11-12T00:00:00Z",
});
const draft = (slug: string, outreach: string): CommentDraftRow => ({
  id: `d-${slug}`, content_slug: slug, content_name: slug, outreach_slug: outreach, post_id: null, sheet_row: null, linkedin_url: null,
  comment_author: "x", comment_text: "c", comment_type: null, reply_text: "r", action: "draft", created_at: "2026-11-12T00:00:00Z",
});
const MAD = "operandi-madeleine-scholl", OTHER = "operandi-canary";
const base = (o: Partial<ShapeInput>): ShapeInput => ({
  posts: [post(MAD, "madeleine", "p1"), post(OTHER, "max", "p2")], analytics: [an(MAD, "madeleine"), an(OTHER, "max")],
  drafts: [draft(MAD, "madeleine"), draft(OTHER, "max")], off: [MAD], isAdmin: false, clientSlug: "madeleine", acceptLanguage: "en-US", ...o,
});

test("4: a client only gets the switched-off list for clients it can see", () => {
  const r = shapeContent(base({ posts: [post(OTHER, "max", "p2")], analytics: [an(OTHER, "max")], drafts: [draft(OTHER, "max")], clientSlug: "max" }));
  assert.deepEqual(r.commentRepliesOff, []);
  const m = shapeContent(base({ posts: [post(MAD, "madeleine", "p1")], analytics: [an(MAD, "madeleine")], drafts: [draft(MAD, "madeleine")] }));
  assert.deepEqual(m.commentRepliesOff, [MAD]);
});

test("5: a client does not receive the engine's learning or the scores", () => {
  const r = shapeContent(base({}));
  for (const a of r.analytics) {
    assert.equal(a.distilled_rules, null); assert.equal(a.hard_negatives, null); assert.equal(a.exemplar_posts, null);
    assert.equal(a.topic_icp_fit, null); assert.equal(a.regression_alert, null); assert.equal(a.avg_icp_pct, null);
  }
  for (const p of r.posts) {
    assert.equal(p.engagement?.score, undefined); assert.equal(p.engagement?.audience, undefined);
    assert.equal(p.engagement?.impressions, 100); assert.equal(p.engagement?.reactions, 3);
  }
  assert.ok(!JSON.stringify(r).includes("icp_pct\":0.4"));
});

test("5: the admin receives everything", () => {
  const r = shapeContent(base({ isAdmin: true, clientSlug: null }));
  assert.deepEqual(r.analytics[0].distilled_rules, ["r"]);
  assert.equal(r.posts[0].engagement?.score, 7.5);
  assert.deepEqual(r.posts[0].engagement?.audience, { icp: 2, total: 5, icp_pct: 0.4 });
});

test("6: Madeleine's replies are hidden from her, the admin keeps seeing them", () => {
  const client = shapeContent(base({}));
  assert.deepEqual(client.drafts.map(d => d.content_slug), [OTHER]);
  const admin = shapeContent(base({ isAdmin: true, clientSlug: null }));
  assert.deepEqual(admin.drafts.map(d => d.content_slug).sort(), [MAD, OTHER].sort());
  assert.deepEqual(admin.commentRepliesOff, []);
});

test("8: the client's language holds with no posts at all", () => {
  const r = shapeContent(base({ posts: [], analytics: [], drafts: [], clientSlug: "madeleine", acceptLanguage: "en-US" }));
  assert.equal(r.locale, "de-DE");
  assert.equal(shapeContent(base({ posts: [], analytics: [], drafts: [], clientSlug: "max" })).locale, "en-US");
  assert.equal(shapeContent(base({ isAdmin: true, clientSlug: null, acceptLanguage: "es-ES" })).locale, "es-ES");
});
