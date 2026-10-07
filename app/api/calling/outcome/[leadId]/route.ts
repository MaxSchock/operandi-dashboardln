import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { CALL_OUTCOMES, isEmail, stageAfterCall, stageOf, type CallOutcome, type CallingState } from "@/lib/calling";

function isoOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
import { backTo, changedNothing, loadLeadForActor, reasonOf, requireFeature, resolveActor, strategist } from "@/lib/calling-server";
import { answer } from "@/lib/form-answer";

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
  // The form sends ISO instants computed in the operator's browser. A bare
  // datetime-local value would be read as UTC here and ring an hour or two late.
  const callback_at = isoOrNull(fd.get("callback_at"));
  const meeting_at = isoOrNull(fd.get("meeting_at"));
  const linkedin_connect = fd.get("linkedin_connect") === "on";
  const branch = String(fd.get("branch") ?? "generic");
  const emailRaw = fd.has("email") ? String(fd.get("email") ?? "").trim().toLowerCase() : null;
  const email_consent = fd.get("email_consent") === "on";
  const now = new Date().toISOString();
  const back = backTo(req);
  back.hash = `lead-${lid}`;
  if (emailRaw && !isEmail(emailRaw)) {
    back.searchParams.set("notice", "call:bad_email");
    return answer(req, back);
  }

  const admin = serviceRoleClient().schema("outreach");
  const cs = (state.channel_state ?? {}) as Record<string, unknown>;
  const prev = ((cs.calling as CallingState | undefined) ?? { status: "queued", batch: "legacy", added_at: now, calls: 0 });
  const prevStage = stageOf(prev, state.current_stage);
  const stage = stageAfterCall(prevStage, outcome);
  const calling: CallingState = {
    ...prev,
    status: outcome,
    stage,
    calls: (prev.calls ?? 0) + 1,
    last_call_at: now,
    last_notes: notes || prev.last_notes || null,
    callback_at: outcome === "red" ? null : callback_at,
    meeting_at: outcome === "green" ? (meeting_at ?? prev.meeting_at ?? null) : (prev.meeting_at ?? null),
    closed_reason: stage === "closed" ? "no_interest" : null,
    linkedin_connect: linkedin_connect || prev.linkedin_connect || false,
    // On an orange call the box is the answer to "can I send you something?", so an
    // unticked box takes back an earlier yes (Codex, 2026-09-30). Other outcomes keep it.
    ...(outcome === "orange" && email_consent !== !!prev.email_consent
      ? { email_consent, email_consent_at: email_consent ? now : null }
      : {}),
  };

  // A corrected or dictated address replaces the stored one: the call is the best source.
  if (emailRaw) {
    const { data: leadRow } = await admin.from("leads").select("email").eq("id", lid).maybeSingle();
    if ((leadRow?.email ?? "").toLowerCase() !== emailRaw) {
      const { error: emErr } = await admin.from("leads").update({ email: emailRaw, email_bounced_at: null }).eq("id", lid);
      if (emErr) return NextResponse.json({ error: `email not saved: ${emErr.message}` }, { status: 500 });
    }
  }
  const patch: Record<string, unknown> = { channel_state: { ...cs, calling }, updated_at: now };
  if (linkedin_connect && state.current_stage === "paused") patch.current_stage = "pre_contact";
  else if (!linkedin_connect && (outcome === "red" || outcome === "green") && state.current_stage === "pre_contact") {
    patch.current_stage = "paused";
  }
  // State first, event second. The other way round, a state row that had moved left the
  // call logged and returned an error, so retrying duplicated the event (Codex, 2026-09-03).
  const stRes = await admin.from("lead_state").update(patch).eq("lead_id", lid).select("lead_id");
  if (stRes.error) return NextResponse.json({ error: stRes.error.message }, { status: 500 });
  if (changedNothing(stRes)) {
    return NextResponse.json(
      { error: "this lead moved or was removed while you were logging the call; nothing was saved" },
      { status: 409 });
  }
  const { error: evErr } = await admin.from("lead_events").insert({
    lead_id: lid, client_slug: state.client_slug, channel: "phone", event_type: "call_outcome",
    occurred_at: now,
    payload: {
      outcome, notes, callback_at: calling.callback_at, meeting_at: calling.meeting_at, stage,
      email: emailRaw, email_consent, linkedin_connect, branch: outcome === "orange" ? branch : null, by: who.actor,
    },
  });
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  if (outcome === "red") {
    // "Not interested" on the phone ends whatever email follow-up was running.
    const { data: open } = await admin.from("email_sequences").select("id")
      .eq("lead_id", lid).in("status", ["pending_approval", "active"]);
    for (const s of open ?? []) {
      await strategist(`/outreach/nurture/sequence/${s.id}/stop`, { query: { reason: "call_red" } });
    }
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
  return answer(req, back);
}
