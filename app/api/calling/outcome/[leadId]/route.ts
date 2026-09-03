import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { CALL_OUTCOMES, type CallOutcome, type CallingState } from "@/lib/calling";
import { backTo, changedNothing, loadLeadForActor, reasonOf, requireFeature, resolveActor, strategist } from "@/lib/calling-server";

/**
 * POST /api/calling/outcome/:leadId  (form body)
 *   outcome=no_answer|red|orange|green  notes=  callback_at=  linkedin_connect=on  branch=
 *
 * Writes the call as a lead_event (channel phone) and updates channel_state.calling.
 * Stage rules (agreed 2026-08-26): nothing automated before the call.
 *   - linkedin_connect ticked  -> stage pre_contact (the connect-only decisor sends a blank invite)
 *   - red or green, no tick    -> stage paused (no invites, no emails; green = meeting, handled by a person)
 *   - orange                   -> opens an email nurturing sequence (email 1 waits for approval)
 * Writes go through the service role after the tenant check, RLS has no INSERT policies.
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

  const fd = await req.formData().catch(() => null);
  if (!fd) return NextResponse.json({ error: "could not read the form" }, { status: 400 });
  const outcome = String(fd.get("outcome") ?? "") as CallOutcome;
  if (!CALL_OUTCOMES.includes(outcome)) return NextResponse.json({ error: "bad outcome" }, { status: 400 });
  const notes = String(fd.get("notes") ?? "").trim().slice(0, 2000);
  const callbackRaw = String(fd.get("callback_at") ?? "").trim();
  const callback_at = callbackRaw ? new Date(callbackRaw).toISOString() : null;
  const linkedin_connect = fd.get("linkedin_connect") === "on";
  const branch = String(fd.get("branch") ?? "generic");
  const now = new Date().toISOString();
  const back = backTo(req);
  back.hash = `lead-${lid}`;

  const admin = serviceRoleClient().schema("outreach");
  const { error: evErr } = await admin.from("lead_events").insert({
    lead_id: lid, client_slug: state.client_slug, channel: "phone", event_type: "call_outcome",
    occurred_at: now,
    payload: { outcome, notes, callback_at, linkedin_connect, branch: outcome === "orange" ? branch : null, by: who.actor },
  });
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  const cs = (state.channel_state ?? {}) as Record<string, unknown>;
  const prev = ((cs.calling as CallingState | undefined) ?? { status: "queued", batch: "legacy", added_at: now, calls: 0 });
  const calling: CallingState = {
    ...prev,
    status: outcome,
    calls: (prev.calls ?? 0) + 1,
    last_call_at: now,
    last_notes: notes || prev.last_notes || null,
    callback_at,
    linkedin_connect: linkedin_connect || prev.linkedin_connect || false,
  };
  const patch: Record<string, unknown> = { channel_state: { ...cs, calling }, updated_at: now };
  if (linkedin_connect && state.current_stage === "paused") patch.current_stage = "pre_contact";
  else if (!linkedin_connect && (outcome === "red" || outcome === "green") && state.current_stage === "pre_contact") {
    patch.current_stage = "paused";
  }
  // The event is already written. If the state row moved underneath us the call would be
  // logged with no state change and the operator would still see success, so say it.
  const stRes = await admin.from("lead_state").update(patch).eq("lead_id", lid).select("lead_id");
  if (stRes.error) return NextResponse.json({ error: stRes.error.message }, { status: 500 });
  if (changedNothing(stRes)) {
    return NextResponse.json(
      { error: "the call was logged but the lead state could not be updated (it moved or was removed)" },
      { status: 409 });
  }

  if (outcome === "orange") {
    const res = await strategist(`/outreach/nurture/${lid}/start`, {
      json: { branch, call_notes: notes, started_by: who.actor },
    });
    if (!res.ok) {
      back.searchParams.set("notice", res.status === 409 ? `nurture:${reasonOf(res.text)}` : `nurture_error:${res.status}`);
    } else {
      back.searchParams.set("notice", "nurture:drafted");
    }
  }
  return NextResponse.redirect(back, 303);
}
