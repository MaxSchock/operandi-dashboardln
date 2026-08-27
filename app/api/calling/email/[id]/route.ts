import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { backTo, reasonOf, resolveActor, strategist } from "@/lib/calling-server";

/**
 * POST /api/calling/email/:id?action=save|approve|reject
 *   save    -> updates subject/body of a draft (service role, tenant-checked)
 *   approve -> strategist sends email 1 from the client's own mailbox (or queues it for the window);
 *              subject/body from the form travel with the approval so "edit then approve" is one click
 *   reject  -> strategist marks the draft rejected and stops the sequence
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mid = Number(id);
  if (Number.isNaN(mid)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const who = await resolveActor();
  if ("error" in who) return who.error;

  const admin = serviceRoleClient().schema("outreach");
  const { data: msg } = await admin.from("email_messages").select("id, client_slug, status").eq("id", mid).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!who.isAdmin && msg.client_slug !== who.clientSlug) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const action = new URL(req.url).searchParams.get("action") ?? "approve";
  const back = backTo(req);
  back.hash = `email-${mid}`;
  const fd = await req.formData().catch(() => null);
  const subject = fd ? String(fd.get("subject") ?? "").trim() : "";
  const body = fd ? String(fd.get("body") ?? "").trim() : "";

  if (action === "save") {
    const { error } = await admin.from("email_messages")
      .update({ subject, body, updated_at: new Date().toISOString() })
      .eq("id", mid).eq("status", "draft");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.redirect(back, 303);
  }

  if (action === "approve" || action === "reject") {
    const res = await strategist(`/outreach/nurture/message/${mid}/${action}`, {
      query: { approved_by: who.actor },
      json: action === "approve" ? { subject: subject || undefined, body: body || undefined } : undefined,
    });
    if (!res.ok) {
      if (res.status === 409) {
        back.searchParams.set("notice", `email:${reasonOf(res.text)}`);
        return NextResponse.redirect(back, 303);
      }
      return NextResponse.json({ error: `strategist ${action} failed: ${res.status} ${res.text.slice(0, 300)}` }, { status: 502 });
    }
    try {
      const j = JSON.parse(res.text);
      back.searchParams.set("notice", j.queued ? "email:queued" : (action === "approve" ? "email:sent" : "email:rejected"));
    } catch { /* ignore */ }
    return NextResponse.redirect(back, 303);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
