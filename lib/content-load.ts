import { createClient } from "@/lib/supabase/server";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";

export type Audience = { icp?: number; peer?: number; off?: number; total?: number; icp_pct?: number } | null;
export type Engagement = {
  reactions?: number; comments?: number; reposts?: number; impressions?: number; score?: number;
  audience?: Audience;
} | null;

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
  topic: string | null;
  pain_id: string | null;
  pain_label: string | null;
  image_url_imgbb: string | null;
  image_url_source: string | null;
  scheduled_for: string | null;
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
  return {
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
