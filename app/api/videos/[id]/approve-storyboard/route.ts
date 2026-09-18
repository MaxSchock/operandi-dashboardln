import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent, needsKeyframes, QUOTA_MESSAGES } from "@/lib/videos";


/**
 * POST /api/videos/:id/approve-storyboard. Two paths:
 *  - Keyframe review (client_features.video_keyframe_review and a storyboard
 *    with drawn shots): NO credit here. The request goes to
 *    keyframes_generating, the engine draws the stills, the client approves
 *    them and /produce consumes the credit. The quota is only checked, so no
 *    stills are drawn for a video that could not be produced anyway.
 *  - Otherwise, the paid gate as before: video_consume_credit() (SECURITY
 *    DEFINER, the single quota choke point) and the render queue.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  // failed renders refund the credit and can be retried by approving again
  if (!["storyboard_ready", "failed"].includes(request.status)) {
    return NextResponse.json({ error: `cannot approve from status ${request.status}` }, { status: 409 });
  }

  const svc = serviceRoleClient();
  const nowIso = new Date().toISOString();

  if (actor.features.video_keyframe_review && needsKeyframes(request.brief, request.storyboard)) {
    const { data: check, error: checkError } = await svc.rpc("video_credit_check", { p_request: request.id });
    if (checkError || !check?.ok) {
      const reason = check?.reason ?? checkError?.message ?? "unknown";
      await addEvent(request.id, "credit_refused", actor, { reason, stage: "storyboard" });
      return NextResponse.json(
        { error: QUOTA_MESSAGES[reason] ?? `cannot start production: ${reason}`, reason },
        { status: 403 },
      );
    }
    const { data: moved } = await svc.from("video_requests")
      .update({
        status: "keyframes_generating",
        storyboard_approved_at: nowIso,
        storyboard_approved_by: actor.tier.userId,
        error: null,
        updated_at: nowIso,
      })
      .eq("id", request.id).eq("status", request.status)
      .select("id").maybeSingle();
    if (!moved) return NextResponse.json({ error: "request changed state, reload the page" }, { status: 409 });
    await addEvent(request.id, "storyboard_approved", actor, { credit: "at_keyframe_approval" });
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return NextResponse.json({ ok: true, next: "keyframes" });
    return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
  }
  const { data: moved } = await svc.from("video_requests")
    .update({
      status: "storyboard_approved",
      storyboard_approved_at: nowIso,
      storyboard_approved_by: actor.tier.userId,
      updated_at: nowIso,
    })
    .eq("id", request.id).eq("status", request.status)
    .select("id").maybeSingle();
  if (!moved) return NextResponse.json({ error: "request changed state, reload the page" }, { status: 409 });

  const { data: verdict, error: rpcError } = await svc.rpc("video_consume_credit", { p_request: request.id });
  if (rpcError || !verdict?.ok) {
    // Not consumable: put it back so the client can keep editing or retry later.
    await svc.from("video_requests")
      .update({ status: "storyboard_ready", storyboard_approved_at: null, storyboard_approved_by: null })
      .eq("id", request.id).eq("status", "storyboard_approved");
    const reason = verdict?.reason ?? rpcError?.message ?? "unknown";
    await addEvent(request.id, "credit_refused", actor, { reason });
    return NextResponse.json(
      { error: QUOTA_MESSAGES[reason] ?? `cannot start production: ${reason}`, reason },
      { status: 403 },
    );
  }

  await addEvent(request.id, "storyboard_approved", actor);
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
