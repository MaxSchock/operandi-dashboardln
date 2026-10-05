import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";
import { isStaged, enqueue } from "@/lib/video-staged";

/**
 * POST /api/videos/:id/submit — the wizard finished uploading and confirming
 * every file: hand the request to the engine (draft -> storyboard_pending).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });
  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (isStaged(request)) {
    // Step by step: the engine writes the shot table and its suggestions; the
    // request stays a draft until that job has run.
    if (request.status !== "draft") return NextResponse.json({ error: "already submitted" }, { status: 409 });
    const res = await enqueue(serviceRoleClient(), request, actor, "script_propose");
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.reason === "already_queued" ? 409 : 400 });
    await addEvent(request.id, "submitted", actor);
    return NextResponse.json({ ok: true });
  }

  const upd = await serviceRoleClient().from("video_requests")
    .update({ status: "storyboard_pending", updated_at: new Date().toISOString() })
    .eq("id", request.id).eq("status", "draft").select("id");
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data?.length) return NextResponse.json({ error: "already submitted" }, { status: 409 });
  await addEvent(request.id, "submitted", actor);
  return NextResponse.json({ ok: true });
}
