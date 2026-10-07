import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";

/** States in which the engine is at work on the request itself (the flow without separate jobs). */
const AT_WORK = new Set(["storyboard_pending", "storyboard_approved", "keyframes_generating", "queued", "rendering",
  "recomposing", "redo_requested", "redoing", "script_pending", "assembling"]);

/**
 * POST /api/videos/:id/close — { action: "close" | "reopen" }.
 * Closing takes a request out of the list: the client or an admin, from any
 * state in which nothing is being worked on. The state it had is kept in the
 * event, and an admin can reopen the request to exactly that state.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });
  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const svc = serviceRoleClient();
  const bad = (msg: string, code = 400) => NextResponse.json({ error: msg }, { status: code });
  const now = new Date().toISOString();

  if (body.action === "reopen") {
    if (!actor.tier.isAdmin) return bad("forbidden", 403);
    if (request.status !== "closed") return bad("this request is not closed", 409);
    const { data: ev } = await svc.from("video_events").select("payload").eq("request_id", request.id)
      .eq("event_type", "request_closed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const from = String((ev?.payload as { from?: string } | null)?.from ?? "");
    if (!from || from === "closed") return bad("the state this request had before it was closed is not on file", 409);
    const upd = await svc.from("video_requests").update({ status: from, updated_at: now })
      .eq("id", request.id).eq("status", "closed").select("id");
    if (upd.error) return bad(upd.error.message, 500);
    if (!upd.data?.length) return bad("the request changed, reload the page", 409);
    await addEvent(request.id, "request_reopened", actor, { to: from });
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "close") return bad("unknown action");
  if (request.status === "closed") return NextResponse.json({ ok: true });
  const BUSY = "This video is being worked on right now. Close it when that step is done.";
  if (AT_WORK.has(request.status)) return bad(BUSY, 409);
  const { count } = await svc.from("video_jobs").select("id", { count: "exact", head: true })
    .eq("request_id", request.id).in("status", ["queued", "running"]);
  if ((count ?? 0) > 0) return bad(BUSY, 409);
  // Matched on the state seen: a step started meanwhile keeps the request open.
  const upd = await svc.from("video_requests").update({ status: "closed", updated_at: now })
    .eq("id", request.id).eq("status", request.status).select("id");
  if (upd.error) return bad(upd.error.message, 500);
  if (!upd.data?.length) return bad("the request changed, reload the page", 409);
  await addEvent(request.id, "request_closed", actor, { from: request.status });
  return NextResponse.json({ ok: true });
}
