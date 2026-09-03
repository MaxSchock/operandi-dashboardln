import { NextRequest, NextResponse } from "next/server";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";

/** Pull the machine reason out of the strategist's FastAPI 409 body ({"detail": "..."}). */
function _reason(body: string): string {
  try {
    const d = JSON.parse(body)?.detail;
    if (typeof d === "string" && d) return d.slice(0, 120);
  } catch { /* not JSON, fall through */ }
  return body.slice(0, 120) || "refused";
}

/**
 * POST /api/admin/dm-proposal/:id
 *   ?action=save     → updates proposed_text (form body or JSON), stays pending
 *   ?action=approve  → calls the strategist to send (camino A direct DM / camino B invite+DM)
 *   ?action=connect  → sends only a blank connection request, proposal stays pending
 *   ?action=reject   → marks the proposal rejected
 *
 * Two roles may act: operandi_admin on anything, and client_operator ONLY on proposals
 * belonging to its own client_slug (checked here against the row, since the write goes
 * through the service-role client and bypasses RLS). approve/connect/reject delegate to
 * the strategist's internal endpoint (it owns degree resolution and the actual send);
 * save writes directly.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pid = Number(id);
  if (Number.isNaN(pid)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const { data: cu } = await sb.from("client_users")
    .select("role,email,client_slug").eq("user_id", user.id).maybeSingle();
  const isAdmin = cu?.role === "operandi_admin";
  const isOperator = cu?.role === "client_operator";
  if (!isAdmin && !isOperator) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (isOperator) {
    // Tenant check against the real row, not against whatever the caller claims.
    const admin = serviceRoleClient();
    const { data: prop } = await admin.schema("outreach").from("dm_proposals")
      .select("client_slug").eq("id", pid).maybeSingle();
    if (!prop || !cu?.client_slug || prop.client_slug !== cu.client_slug) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // Owning the row is not the same as having the product, and the two actions are not
    // the same product: "connect" fires a LinkedIn invitation (outreach), the DM itself is
    // engagement. Ingolf has engagement without outreach and Zayd the reverse, so an OR
    // over both would have let each do the other's action (Codex, 2026-09-03).
    const wanted = (new URL(req.url).searchParams.get("action") ?? "approve") === "connect"
      ? "has_outreach" : "has_engagement";
    const { data: feat, error: featErr } = await admin.schema("outreach").from("client_features")
      .select("has_outreach, has_engagement").eq("client_slug", cu.client_slug).maybeSingle();
    if (featErr) return NextResponse.json({ error: "could not verify entitlements" }, { status: 503 });
    if (feat && (feat as Record<string, boolean | null>)[wanted] !== true) {
      return NextResponse.json({ error: "product not enabled for this client" }, { status: 403 });
    }
  }

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
    const upd = await admin.schema("outreach").from("dm_proposals")
      .update({ proposed_text: text }).eq("id", pid).eq("status", "pending").select("id");
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
    if (!upd.data?.length) {
      return NextResponse.json({ error: "this proposal is no longer pending, your text was not saved" }, { status: 409 });
    }
    return NextResponse.redirect(back);
  }

  if (action === "approve" || action === "reject" || action === "connect") {
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
      // The strategist answers 409 with a reason when it refuses to send (an existing
      // conversation, an invitation already pending). That is a normal outcome the
      // operator must see on the card, not a crash: send it back as a banner.
      const detail = await res.text().catch(() => "");
      if (res.status === 409) {
        back.searchParams.set("notice", _reason(detail));
        return NextResponse.redirect(back);
      }
      return NextResponse.json({ error: `strategist ${action} failed: ${res.status} ${detail.slice(0, 300)}` }, { status: 502 });
    }
    return NextResponse.redirect(back);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
