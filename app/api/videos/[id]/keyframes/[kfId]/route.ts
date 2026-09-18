import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import {
  resolveVideoActor, loadOwnedRequest, addEvent, wantsJson, clientRedraws, MAX_KEYFRAME_REDRAWS, type Keyframe,
} from "@/lib/videos";

/**
 * POST /api/videos/:id/keyframes/:kfId — approve or reject one keyframe while
 * the request waits in keyframes_ready. Rejecting needs a note (it is what the
 * redraw is told to change) and only marks the image; the redraw itself starts
 * from /keyframes/redraw, so the client can go through every image first.
 * Only the latest version of an image can be decided on.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; kfId: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id, kfId } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.status !== "keyframes_ready") {
    return NextResponse.json({ error: `images cannot be reviewed in status ${request.status}` }, { status: 409 });
  }

  let action = "", notes = "";
  if (wantsJson(req)) {
    const b = await req.json();
    action = String(b.action ?? ""); notes = String(b.notes ?? "");
  } else {
    const f = await req.formData();
    action = String(f.get("action") ?? ""); notes = String(f.get("notes") ?? "");
  }
  notes = notes.trim().slice(0, 500);
  if (!["approve", "reject"].includes(action)) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  if (action === "reject" && !notes) {
    return NextResponse.json({ error: "say what should change in this image" }, { status: 400 });
  }

  const svc = serviceRoleClient();
  const { data: rowsData } = await svc.from("video_keyframes")
    .select("id, shot_n, role, storage_key, status, version, notes, qc").eq("request_id", request.id);
  const rows = (rowsData ?? []) as Keyframe[];
  const kf = rows.find(k => k.id === kfId);
  if (!kf) return NextResponse.json({ error: "image not found" }, { status: 404 });
  const newest = Math.max(...rows.filter(k => k.shot_n === kf.shot_n && k.role === kf.role).map(k => k.version));
  if (kf.version !== newest) return NextResponse.json({ error: "a newer version of this image exists, reload the page" }, { status: 409 });
  if (action === "reject" && clientRedraws(rows, kf.shot_n, kf.role) >= MAX_KEYFRAME_REDRAWS) {
    return NextResponse.json({ error: `this image was already redrawn ${MAX_KEYFRAME_REDRAWS} times` }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const patch = action === "approve"
    ? { status: "approved", updated_at: nowIso }
    : { status: "rejected", notes, updated_at: nowIso };
  const from = action === "approve" ? ["proposed"] : ["proposed", "approved"];
  const upd = await svc.from("video_keyframes").update(patch)
    .eq("id", kf.id).in("status", from).select("id");
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data?.length) return NextResponse.json({ error: "the image changed while you were reviewing it" }, { status: 409 });

  await addEvent(request.id, action === "approve" ? "keyframe_approved" : "keyframe_rejected", actor, {
    shot: kf.shot_n, role: kf.role, version: kf.version, ...(notes ? { notes } : {}),
  });
  if (wantsJson(req)) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}#keyframes`, req.url), 303);
}
