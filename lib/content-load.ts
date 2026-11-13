import { headers } from "next/headers";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";
import { commentRepliesOff } from "@/lib/content-config";
import { shapeContent } from "@/lib/content-shape";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";

export type { Audience, Engagement, CalendarRow, AnalyticsRow, CommentDraftRow, ContentData } from "./content-types";
import type { CalendarRow, AnalyticsRow, CommentDraftRow, ContentData } from "./content-types";

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
  let accept: string | null = null;
  try { accept = (await headers()).get("accept-language"); } catch { /* no request */ }
  // Which rows and fields this kind of person receives is decided in one pure place (content-shape).
  const shaped = shapeContent({
    posts, analytics, drafts, off: commentRepliesOff(), isAdmin: tier.isAdmin, clientSlug: tier.clientSlug, acceptLanguage: accept,
  });
  return {
    ...shaped,
    isAdmin: tier.isAdmin,
    // Clients with the content product manage their own posts (approve, edit,
    // revisions, image, date) and generate within a tighter budget.
    ownSlug: !tier.isAdmin && (tier.features?.has_content ?? false) ? tier.clientSlug : null,
    // A failed read must not look like an empty inbox: the whole point of the panel is
    // that someone is waiting for a reply (Codex, 2026-09-02).
    draftsError: draftErr ? draftErr.message : null,
    servedAt: Date.now(),
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
