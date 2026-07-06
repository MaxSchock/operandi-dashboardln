import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";

const QUOTA_MESSAGES: Record<string, string> = {
  weekly_quota_reached: "Weekly quota reached: you have 1 video per week. The next slot opens on Monday.",
  regen_quota_reached: "This video already used its 1 paid regeneration.",
  monthly_cap_reached: "The monthly production budget for your account is used up. Ask Max if you need more.",
  video_not_enabled: "Video is not enabled for this client.",
  duration_exceeds_max: "The requested duration exceeds your plan limit.",
};

/**
 * POST /api/videos/:id/approve-storyboard — the paid gate. Marks the
 * storyboard approved and asks video_consume_credit() (SECURITY DEFINER, the
 * single quota choke point) for the credit. Only a successful consume moves
 * the request to the render queue.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.status !== "storyboard_ready") {
    return NextResponse.json({ error: `cannot approve from status ${request.status}` }, { status: 409 });
  }

  const svc = serviceRoleClient();
  const nowIso = new Date().toISOString();
  const { data: moved } = await svc.from("video_requests")
    .update({
      status: "storyboard_approved",
      storyboard_approved_at: nowIso,
      storyboard_approved_by: actor.tier.userId,
      updated_at: nowIso,
    })
    .eq("id", request.id).eq("status", "storyboard_ready")
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
