import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent, wantsJson, latestKeyframes, type Keyframe } from "@/lib/videos";

/**
 * POST /api/videos/:id/keyframes/redraw — send the images the client rejected
 * back to the engine (keyframes_ready -> keyframes_generating). The engine
 * redraws only those, with the client's note, as a new version; approved
 * images are kept. Still no credit consumed.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.status !== "keyframes_ready") {
    return NextResponse.json({ error: `cannot redraw from status ${request.status}` }, { status: 409 });
  }

  const svc = serviceRoleClient();
  const { data } = await svc.from("video_keyframes")
    .select("id, shot_n, role, storage_key, status, version, notes, qc").eq("request_id", request.id);
  const rejected = latestKeyframes((data ?? []) as Keyframe[]).filter(k => k.status === "rejected");
  if (!rejected.length) return NextResponse.json({ error: "no image is marked for a redraw" }, { status: 400 });

  const upd = await svc.from("video_requests")
    .update({ status: "keyframes_generating", updated_at: new Date().toISOString() })
    .eq("id", request.id).eq("status", "keyframes_ready").select("id");
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data?.length) return NextResponse.json({ error: "request changed state, reload the page" }, { status: 409 });

  await addEvent(request.id, "keyframes_redraw_requested", actor, {
    images: rejected.map(k => ({ shot: k.shot_n, role: k.role, version: k.version })),
  });
  if (wantsJson(req)) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
