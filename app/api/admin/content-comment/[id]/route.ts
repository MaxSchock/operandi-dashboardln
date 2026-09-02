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
    .select("id, content_slug").eq("id", id).limit(1).maybeSingle();
  if (!owned) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svc = serviceRoleClient();
  const { error } = await svc.from("content_engine_comment_replies")
    .update({ action: action === "done" ? "draft_done" : "draft" })
    .eq("id", id)
    .in("action", ["draft", "draft_sent", "draft_done"]);
  const back = new URL(req.headers.get("referer") ?? "/content", req.url);
  back.hash = `comments-${owned.content_slug}`;
  if (error) {
    back.searchParams.set("actionError", `comment draft: ${error.message}`.slice(0, 220));
  } else {
    back.searchParams.delete("actionError");
  }
  return NextResponse.redirect(back, 303);
}
