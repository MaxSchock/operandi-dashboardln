import { NextRequest, NextResponse } from "next/server";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/content-comment/:id?action=done|reopen
 *
 * Marks a drafted comment reply as posted by hand (action 'draft_done') or puts it
 * back in the list ('draft'). The draft rows are written by the content-engine daemon
 * (engine_config.comments.channel="dashboard"); nothing here touches LinkedIn.
 * Ownership is proven through the RLS-scoped view outreach.content_comment_drafts:
 * finding the id there means the caller may act on it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const action = new URL(req.url).searchParams.get("action") ?? "done";
  if (action !== "done" && action !== "reopen") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { data: owned } = await sb.schema("outreach").from("content_comment_drafts")
    .select("id, content_slug, outreach_slug").eq("id", id).limit(1).maybeSingle();
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Ownership comes from the RLS view; the content product is a separate question
  // (Codex, 2026-09-03).
  const { data: cu, error: cuErr } = await sb.from("client_users").select("role, client_slug")
    .eq("user_id", user.id).maybeSingle();
  if (cuErr) return NextResponse.json({ error: "could not verify the caller" }, { status: 503 });
  if (cu?.role !== "operandi_admin") {
    // Not an admin and no client we can name: we cannot check anything, so we allow
    // nothing. Before, a missing row skipped the gate entirely (Codex, 2026-09-03).
    if (!cu?.client_slug) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data: feat, error: featErr } = await serviceRoleClient().schema("outreach")
      .from("client_features").select("has_content").eq("client_slug", cu.client_slug).maybeSingle();
    if (featErr) return NextResponse.json({ error: "could not verify entitlements" }, { status: 503 });
    if (feat && feat.has_content !== true) {
      return NextResponse.json({ error: "product not enabled for this client" }, { status: 403 });
    }
  }

  const svc = serviceRoleClient();
  // select() back: a conditional update that matched nothing returns error=null, and
  // reporting that as success hides a lost click (Codex, 2026-09-02).
  const { data: updated, error } = await svc.from("content_engine_comment_replies")
    .update({ action: action === "done" ? "draft_done" : "draft" })
    .eq("id", id)
    .in("action", ["draft", "draft_sent", "draft_done"])
    .select("id");
  const back = new URL(req.headers.get("referer") ?? "/content", req.url);
  back.hash = `comments-${owned.content_slug}`;
  if (error) {
    back.searchParams.set("actionError", `comment draft: ${error.message}`.slice(0, 220));
  } else if (!updated || updated.length === 0) {
    back.searchParams.set("actionError", "That draft changed while you were looking at it. Reload the page.");
  } else {
    back.searchParams.delete("actionError");
  }
  return NextResponse.redirect(back, 303);
}
