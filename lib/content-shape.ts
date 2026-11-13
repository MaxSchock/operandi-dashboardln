/** What the server lets each kind of person receive (no imports from the app, so node can test it). */
import type { AnalyticsRow, CalendarRow, CommentDraftRow, Engagement } from "./content-types";
import { LOCALE_BY_CONTENT_SLUG, localeForOutreach } from "./content-config";
import { pickLocale } from "./content-format";

export type ShapeInput = {
  posts: CalendarRow[]; analytics: AnalyticsRow[]; drafts: CommentDraftRow[];
  /** The slugs switched off by configuration (all clients, before looking at who asks). */
  off: string[];
  isAdmin: boolean;
  /** The outreach slug of the signed-in person (null for an admin without client). */
  clientSlug: string | null;
  acceptLanguage: string | null;
};

export type Shaped = {
  posts: CalendarRow[]; analytics: AnalyticsRow[]; drafts: CommentDraftRow[];
  commentRepliesOff: string[]; locale: string;
};

/** What a client never sees in the screen: the engine's learning and per-post scores. The
 * browser hid them already; this is so they do not even travel there. */
export function stripInternalAnalytics(a: AnalyticsRow): AnalyticsRow {
  return {
    ...a,
    avg_icp_pct: null, topic_icp_fit: null, topic_weights: null, first_pass_rate_30d: null,
    regression_alert: null, distilled_rules: null, hard_negatives: null, exemplar_posts: null,
  };
}

export function stripInternalEngagement(e: Engagement): Engagement {
  if (!e) return e;
  const { score: _score, audience: _audience, ...plain } = e;
  void _score; void _audience;
  return plain;
}

export function shapeContent(i: ShapeInput): Shaped {
  const visible = new Set<string>([
    ...i.posts.map(p => p.content_slug), ...i.analytics.map(a => a.content_slug), ...i.drafts.map(d => d.content_slug),
  ]);
  // The admin receives everything. A client person gets only the list of their own switched-off
  // clients, and never the rows behind it.
  const off = i.isAdmin ? [] : i.off.filter(s => visible.has(s));
  const drafts = i.isAdmin ? i.drafts : i.drafts.filter(d => !off.includes(d.content_slug));
  const posts = i.isAdmin ? i.posts : i.posts.map(p => ({ ...p, engagement: stripInternalEngagement(p.engagement) }));
  const analytics = i.isAdmin ? i.analytics : i.analytics.map(stripInternalAnalytics);
  // The language comes from the client's configuration, so it holds before it has a single post.
  const own = i.posts.find(p => p.outreach_slug === i.clientSlug)?.content_slug;
  const configured = i.isAdmin ? null : (localeForOutreach(i.clientSlug) ?? (own ? LOCALE_BY_CONTENT_SLUG[own] : null) ?? null);
  return { posts, analytics, drafts, commentRepliesOff: off, locale: pickLocale(configured, i.acceptLanguage) };
}
