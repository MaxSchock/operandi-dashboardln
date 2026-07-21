import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/group/:id?action=approve|reject|candidate|reset
 *
 * Human curation of a discovered LinkedIn group. Admin, or the client that owns the
 * group. Ownership is proven through RLS: the tenant-filtered outreach.content_groups
 * view only returns rows for the caller's slug, so finding this group_row_id there means
 * the caller owns it. Delegates to the strategist proxy -> content-engine daemon.
 */
const ACTIONS = new Set(["approve", "reject", "candidate", "reset"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gid = Number(id);
  if (Number.isNaN(gid)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const action = new URL(req.url).searchParams.get("action") ?? "";
  if (!ACTIONS.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 400 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { data: cu } = await sb.from("client_users").select("role,email").eq("user_id", user.id).maybeSingle();
  const isAdmin = cu?.role === "operandi_admin";

  if (!isAdmin) {
    // Ownership via RLS: the view returns only the caller's rows.
    const { data: owned } = await sb.from("content_groups").select("group_row_id").eq("group_row_id", gid).maybeSingle();
    if (!owned) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const base = process.env.STRATEGIST_BASE_URL;
  const token = process.env.STRATEGIST_WEBHOOK_TOKEN;
  if (!base) return NextResponse.json({ error: "STRATEGIST_BASE_URL not set" }, { status: 500 });

  const curatedBy = cu?.email ?? user.email ?? "operandi_admin";
  const back = new URL(req.headers.get("referer") ?? "/distribution", req.url);

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/content/group/${gid}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-webhook-token": token } : {}) },
      body: JSON.stringify({ curated_by: curatedBy }),
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
