import { headers } from "next/headers";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";
import { commentRepliesOff, LOCALE_BY_CONTENT_SLUG } from "@/lib/content-config";
import { pickLocale } from "@/lib/content-format";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";

export type Audience = { icp?: number; peer?: number; off?: number; total?: number; icp_pct?: number } | null;
export type Engagement = {
  reactions?: number; comments?: number; reposts?: number; impressions?: number; score?: number;
  audience?: Audience;
} | null;

import type { ImageReview } from "@/lib/image-review";

export type CalendarRow = {
  content_slug: string;
  content_name: string | null;
  outreach_slug: string | null;
  post_id: string;
  sheet_row: number | null;
  post_type: string | null;
  text_content: string | null;
  text_status: string | null;
  image_status: string | null;
  text_notes?: string | null;
  /** Image notes and the latest check of the picture by the engine's reviewer
   * (view migration 2026_11_10); absent before it is applied. */
  image_notes?: string | null;
  image_review?: ImageReview | null;
  topic: string | null;
  pain_id: string | null;
  pain_label: string | null;
  /** Writing style the post was drawn with (plan 2026-11-04); null for clients without the flag. */
  style?: string | null;
  style_label?: string | null;
  image_url_imgbb: string | null;
  image_url_source: string | null;
  /** The file of a video post; the view exposes it next to the image links. */
  video_url?: string | null;
  scheduled_for: string | null;
  /** When the engine wrote the post (UTC). Not in the content_calendar view: it is read
   * from content_engine_posts by id and is null if that read fails. */
  created_at?: string | null;
  published_at: string | null;
  linkedin_url: string | null;
  linkedin_deleted_at: string | null;
  engagement: Engagement;
};

export type AnalyticsRow = {
  content_slug: string;
  content_name: string | null;
  outreach_slug: string | null;
  avg_icp_pct: string | null;
  topic_icp_fit: Record<string, number> | null;
  topic_weights: Record<string, number> | null;
  first_pass_rate_30d: string | null;
  regression_alert: { since: string; ma_short: number; ma_long: number; ratio: number } | null;
  distilled_rules: string[] | null;
  hard_negatives: string[] | null;
  exemplar_posts: { id: string; text: string; topic: string; score: number }[] | null;
  computed_at: string | null;
};

export type CommentDraftRow = {
  id: string;
  content_slug: string;
  content_name: string | null;
  outreach_slug: string | null;
  post_id: string | null;
  sheet_row: number | null;
  linkedin_url: string | null;
  comment_author: string | null;
  comment_text: string | null;
  comment_type: string | null;
  reply_text: string | null;
  action: string;
  created_at: string;
};

export type ContentData = {
  isAdmin: boolean;
  /** The client slug whose posts this (non-admin) user manages, if any. */
  ownSlug: string | null;
  posts: CalendarRow[];
  analytics: AnalyticsRow[];
  drafts: CommentDraftRow[];
  draftsError: string | null;
  /** Content slugs whose comment replies are switched off for the client (see content-config). */
  commentRepliesOff: string[];
  /** Locale dates are written in: the client's own, else the browser's. */
  locale: string;
};

/** Everything the Content page shows, for the signed-in user and the client
 * scope of the sidebar. The page renders it on the server and the board asks
 * GET /api/content for the same shape in the background, so a post that is
 * being rewritten or drawn appears in its own card without loading the page
 * again. Returns null when nobody is signed in. */
export async function loadContent(): Promise<ContentData | null> {
  const tier = await getTier();
  if (!tier.userId) return null;
  const sb = await createClient();
  const scope = await getClientScope();
  const [{ data: calData }, { data: anData }, { data: draftData, error: draftErr }] = await Promise.all([
    sb.from("content_calendar").select("*").order("scheduled_for", { ascending: false }).limit(500),
    sb.from("content_analytics").select("*"),
    // Comment replies drafted by the engine but never posted by it: since 02-09-2026 a
    // person copies them into LinkedIn (tool-posted replies count as automated comments).
    sb.from("content_comment_drafts").select("*")
      .in("action", ["draft", "draft_sent", "draft_done"])
      .order("created_at", { ascending: false }).limit(200),
  ]);
  let posts = (calData ?? []) as CalendarRow[];
  let analytics = (anData ?? []) as AnalyticsRow[];
  let drafts = (draftData ?? []) as CommentDraftRow[];
  if (scope) {
    posts = posts.filter(p => p.outreach_slug === scope);
    analytics = analytics.filter(a => a.outreach_slug === scope);
    drafts = drafts.filter(d => d.outreach_slug === scope);
  }
  await attachCreatedAt(posts);
  // Switched off for a client: its replies are not sent to the browser at all.
  const off = commentRepliesOff();
  drafts = drafts.filter(d => !off.includes(d.content_slug));
  const own = posts.find(p => p.outreach_slug === tier.clientSlug)?.content_slug;
  let accept: string | null = null;
  try { accept = (await headers()).get("accept-language"); } catch { /* no request */ }
  const locale = pickLocale(!tier.isAdmin && own ? LOCALE_BY_CONTENT_SLUG[own] : null, accept);
  return {
    commentRepliesOff: off, locale,
    isAdmin: tier.isAdmin,
    // Clients with the content product manage their own posts (approve, edit,
    // revisions, image, date) and generate within a tighter budget.
    ownSlug: !tier.isAdmin && (tier.features?.has_content ?? false) ? tier.clientSlug : null,
    posts, analytics, drafts,
    // A failed read must not look like an empty inbox: the whole point of the panel is
    // that someone is waiting for a reply (Codex, 2026-09-02).
    draftsError: draftErr ? draftErr.message : null,
  };
}

/** The creation time lives only in content_engine_posts; the calendar view does not carry
 * it. The ids come from that view (RLS already decided which rows this person may see) and
 * only the timestamp goes back, never anything else of the row. A failure leaves the cards
 * without a creation date, it never breaks the page. */
async function attachCreatedAt(posts: CalendarRow[]): Promise<void> {
  if (posts.length === 0 || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const ids = posts.map(p => p.post_id);
    const batches: string[][] = [];
    // Batches: hundreds of ids in one .in() can pass the URL limit.
    for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
    const found = new Map<string, string>();
    await Promise.all(batches.map(async batch => {
      const { data, error } = await serviceRoleClient().from("content_engine_posts").select("id,created_at").in("id", batch);
      if (error) { console.error("content: created_at read failed", error.message); return; }
      for (const d of (data ?? []) as { id: string; created_at: string | null }[]) if (d.created_at) found.set(d.id, d.created_at);
    }));
    for (const p of posts) p.created_at = found.get(p.post_id) ?? null;
  } catch (e) { console.error("content: created_at failed", e); }
}
