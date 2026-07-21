import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/group-post/:id?action=approve|reject|edit|mark-sent
 *   body (form or JSON): variant_text (edit)
 *
 * Approval queue for a per-group post variant (vía B: approve marks it ready, the human
 * publishes it in the group, then mark-sent records it and increments the weekly cap
 * ledger server-side). Admin, or the client that owns it (proven through the
 * tenant-filtered outreach.content_group_queue view). Delegates to the strategist proxy.
 */
const ACTIONS = new Set(["approve", "reject", "edit", "mark-sent"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const qid = Number(id);
  if (Number.isNaN(qid)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const action = new URL(req.url).searchParams.get("action") ?? "";
  if (!ACTIONS.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 400 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { data: cu } = await sb.from("client_users").select("role,email").eq("user_id", user.id).maybeSingle();
  const isAdmin = cu?.role === "operandi_admin";

  if (!isAdmin) {
    const { data: owned } = await sb.from("content_group_queue").select("queue_row_id").eq("queue_row_id", qid).maybeSingle();
    if (!owned) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const payload: Record<string, string> = { approved_by: cu?.email ?? user.email ?? "operandi_admin" };
  if (action === "edit") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = await req.json();
      payload.variant_text = String(j.variant_text ?? "");
    } else {
      const fd = await req.formData();
      payload.variant_text = String(fd.get("variant_text") ?? "");
    }
  }

  const base = process.env.STRATEGIST_BASE_URL;
  const token = process.env.STRATEGIST_WEBHOOK_TOKEN;
  if (!base) return NextResponse.json({ error: "STRATEGIST_BASE_URL not set" }, { status: 500 });

  const back = new URL(req.headers.get("referer") ?? "/distribution", req.url);
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/content/group-post/${qid}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-webhook-token": token } : {}) },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: `strategist unreachable: ${String(e)}` }, { status: 502 });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let reason = detail;
    try { reason = JSON.parse(detail).detail ?? detail; } catch { /* keep raw */ }
    back.searchParams.set("actionError", String(reason).slice(0, 220));
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.delete("actionError");
  return NextResponse.redirect(back, 303);
}
