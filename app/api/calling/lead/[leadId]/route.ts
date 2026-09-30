import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { CALLING_STAGES, type CallingStage, type CallingState } from "@/lib/calling";
import { backTo, changedNothing, loadLeadForActor, requireFeature, resolveActor, strategist } from "@/lib/calling-server";

/**
 * POST /api/calling/lead/:leadId?action=...  (form body)
 *   reply_handled            the operator has dealt with the latest reply (it leaves "Today")
 *   stage   stage=to_call|follow_up|meeting|closed   move the lead by hand
 *   meeting meeting_at=ISO   set or change the meeting date
 *
 * Moving to closed also stops an open email sequence, as a red call does.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await ctx.params;
  const lid = Number(leadId);
  if (Number.isNaN(lid)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const who = await resolveActor();
  if ("error" in who) return who.error;
  const gate = await requireFeature(who, "has_outreach");
  if (gate) return gate;
  const state = await loadLeadForActor(lid, who);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });

  const action = req.nextUrl.searchParams.get("action") ?? "";
  const fd = await req.formData().catch(() => new FormData());
  const now = new Date().toISOString();
  const cs = (state.channel_state ?? {}) as Record<string, unknown>;
  const prev = (cs.calling as CallingState | undefined) ?? { status: "queued", batch: "legacy", added_at: now, calls: 0 };
  let calling: CallingState;
  let event: Record<string, unknown>;

  if (action === "reply_handled") {
    calling = { ...prev, reply_handled_at: now };
    event = { action };
  } else if (action === "stage") {
    const stage = String(fd.get("stage") ?? "") as CallingStage;
    if (!CALLING_STAGES.includes(stage)) return NextResponse.json({ error: "bad stage" }, { status: 400 });
    calling = {
      ...prev, stage,
      closed_reason: stage === "closed" ? (String(fd.get("reason") ?? "") || "by_hand") : null,
      callback_at: stage === "closed" ? null : prev.callback_at ?? null,
    };
    event = { action, stage, from: prev.stage ?? null };
  } else if (action === "meeting") {
    const raw = String(fd.get("meeting_at") ?? "").trim();
    const d = raw ? new Date(raw) : null;
    if (d && Number.isNaN(d.getTime())) return NextResponse.json({ error: "bad date" }, { status: 400 });
    calling = { ...prev, stage: "meeting", meeting_at: d ? d.toISOString() : null };
    event = { action, meeting_at: calling.meeting_at };
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const admin = serviceRoleClient().schema("outreach");
  const res = await admin.from("lead_state")
    .update({ channel_state: { ...cs, calling }, updated_at: now }).eq("lead_id", lid).select("lead_id");
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  if (changedNothing(res)) return NextResponse.json({ error: "lead moved, nothing saved" }, { status: 409 });
  await admin.from("lead_events").insert({
    lead_id: lid, client_slug: state.client_slug, channel: "phone", event_type: "calling_update",
    occurred_at: now, payload: { ...event, by: who.actor },
  });

  if (calling.stage === "closed") {
    const { data: open } = await admin.from("email_sequences").select("id")
      .eq("lead_id", lid).in("status", ["pending_approval", "active"]);
    for (const s of open ?? []) {
      await strategist(`/outreach/nurture/sequence/${s.id}/stop`, { query: { reason: "closed_by_hand" } });
    }
  }
  const back = backTo(req);
  back.hash = `lead-${lid}`;
  return NextResponse.redirect(back, 303);
}
