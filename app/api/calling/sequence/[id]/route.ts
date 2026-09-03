import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { backTo, reasonOf, requireFeature, resolveActor, strategist } from "@/lib/calling-server";

/** POST /api/calling/sequence/:id  -> stops an email nurturing sequence (operator decision). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sid = Number(id);
  if (Number.isNaN(sid)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const who = await resolveActor();
  if ("error" in who) return who.error;
  const gate = await requireFeature(who, "has_outreach");
  if (gate) return gate;
  const admin = serviceRoleClient().schema("outreach");
  const { data: seq } = await admin.from("email_sequences").select("id, client_slug").eq("id", sid).maybeSingle();
  // One answer for "does not exist" and "not yours", so the response cannot be used to
  // enumerate ids that belong to other clients.
  if (!seq || (!who.isAdmin && seq.client_slug !== who.clientSlug)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const res = await strategist(`/outreach/nurture/sequence/${sid}/stop`, { query: { reason: `operator:${who.actor}` } });
  const back = backTo(req);
  if (!res.ok && res.status !== 409) {
    return NextResponse.json({ error: `strategist stop failed: ${res.status} ${res.text.slice(0, 300)}` }, { status: 502 });
  }
  back.searchParams.set("notice", res.ok ? "email:stopped" : `email:${reasonOf(res.text)}`);
  return NextResponse.redirect(back, 303);
}
