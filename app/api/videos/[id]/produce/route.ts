import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent, wantsJson, latestKeyframes, QUOTA_MESSAGES, type Keyframe } from "@/lib/videos";

/**
 * POST /api/videos/:id/produce — "Approve and produce". The paid gate of the
 * keyframe review: every image approved, then video_consume_credit() consumes
 * the credit and queues the render, which reuses the approved stills (they are
 * already paid for). The function re-checks the approvals itself; this route
 * checks first only to give a clear message.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.status !== "keyframes_ready") {
    return NextResponse.json({ error: `cannot produce from status ${request.status}` }, { status: 409 });
  }

  const svc = serviceRoleClient();
  const { data } = await svc.from("video_keyframes")
    .select("id, shot_n, role, storage_key, status, version, notes, qc").eq("request_id", request.id);
  const latest = latestKeyframes((data ?? []) as Keyframe[]);
  if (!latest.length || latest.some(k => k.status !== "approved")) {
    return NextResponse.json({ error: QUOTA_MESSAGES.keyframes_not_approved }, { status: 409 });
  }

  const { data: verdict, error: rpcError } = await svc.rpc("video_consume_credit", { p_request: request.id });
  if (rpcError || !verdict?.ok) {
    const reason = verdict?.reason ?? rpcError?.message ?? "unknown";
    await addEvent(request.id, "credit_refused", actor, { reason, stage: "keyframes" });
    return NextResponse.json(
      { error: QUOTA_MESSAGES[reason] ?? `cannot start production: ${reason}`, reason },
      { status: 403 },
    );
  }

  await addEvent(request.id, "keyframes_approved", actor, { images: latest.length });
  if (wantsJson(req)) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
