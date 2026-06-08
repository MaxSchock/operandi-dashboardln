import { NextRequest, NextResponse } from "next/server";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";

const ALLOWED = new Set(["pause-autopilot", "freeze-arm", "force-topup", "cancel-action"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!ALLOWED.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 400 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const { data: cu } = await sb.from("client_users").select("role").eq("user_id", user.id).maybeSingle();
  if (cu?.role !== "operandi_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const adminSb = serviceRoleClient();

  if (action === "pause-autopilot") {
    const slug = url.searchParams.get("slug");
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    await adminSb.from("clients_master").update({ autopilot_tier: 0 }).eq("client_slug", slug);
    return NextResponse.redirect(new URL(`/admin/clients/${slug}`, req.url));
  }

  if (action === "freeze-arm") {
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await adminSb.schema("outreach").from("bandit_arms").update({
      active: false, freeze_reason: `admin_${user.email ?? user.id}`,
    }).eq("id", Number(id));
    return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/admin", req.url));
  }

  if (action === "force-topup") {
    const slug = url.searchParams.get("slug");
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    // Fire-and-forget to strategist
    const trigger = process.env.STRATEGIST_TRIGGER_URL ?? "https://sswebhook.figura-studio.com/strategist/trigger/outreach-tick";
    const token = process.env.STRATEGIST_WEBHOOK_TOKEN ?? "";
    fetch(trigger, { method: "POST", headers: { "x-webhook-token": token } }).catch(() => {});
    return NextResponse.redirect(new URL(`/admin/clients/${slug}`, req.url));
  }

  if (action === "cancel-action") {
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await adminSb.schema("outreach").from("lead_actions").update({ status: "cancelled" }).eq("id", Number(id));
    return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/admin", req.url));
  }

  return NextResponse.json({ error: "unhandled" }, { status: 500 });
}
