import { NextRequest, NextResponse } from "next/server";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/dm-proposal/:id
 *   ?action=save     → updates proposed_text (form body or JSON), stays pending
 *   ?action=approve  → calls the strategist to dispatch (camino A direct DM / camino B invite+DM)
 *   ?action=reject   → marks the proposal rejected
 *
 * Operandi-admin only. approve/reject delegate to the strategist's internal endpoint
 * (it owns the connection-degree resolution + lead_action enqueue); save writes directly.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pid = Number(id);
  if (Number.isNaN(pid)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const { data: cu } = await sb.from("client_users").select("role,email").eq("user_id", user.id).maybeSingle();
  if (cu?.role !== "operandi_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const action = new URL(req.url).searchParams.get("action") ?? "approve";
  const approver = cu?.email ?? user.email ?? "operandi_admin";
  const back = new URL(req.headers.get("referer") ?? "/engagement", req.url);

  if (action === "save") {
    let text = "";
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = await req.json();
      text = String(j.proposed_text ?? "");
    } else {
      const fd = await req.formData();
      text = String(fd.get("proposed_text") ?? "");
    }
    const admin = serviceRoleClient();
    const { error } = await admin.schema("outreach").from("dm_proposals")
      .update({ proposed_text: text }).eq("id", pid).eq("status", "pending");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.redirect(back);
  }

  if (action === "approve" || action === "reject") {
    const base = process.env.STRATEGIST_BASE_URL;
    const token = process.env.STRATEGIST_WEBHOOK_TOKEN;
    if (!base) return NextResponse.json({ error: "STRATEGIST_BASE_URL not set" }, { status: 500 });
    const url = `${base.replace(/\/$/, "")}/outreach/dm-proposal/${pid}/${action}?approved_by=${encodeURIComponent(approver)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: token ? { "x-webhook-token": token } : {},
        cache: "no-store",
      });
    } catch (e) {
      return NextResponse.json({ error: `strategist unreachable: ${String(e)}` }, { status: 502 });
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: `strategist ${action} failed: ${res.status} ${detail.slice(0, 300)}` }, { status: 502 });
    }
    return NextResponse.redirect(back);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
