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
  // Every control here answered with a redirect no matter what the write did. An admin
  // pausing a client's autopilot walked away believing it was paused (Codex, 2026-09-03).
  const failed = (what: string, detail: string) =>
    NextResponse.json({ error: `${what} did not apply: ${detail}` }, { status: 409 });

  if (action === "pause-autopilot") {
    const slug = url.searchParams.get("slug");
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    const r = await adminSb.from("clients_master")
      .update({ autopilot_tier: 0 }).eq("client_slug", slug).select("client_slug");
    if (r.error) return failed("pause-autopilot", r.error.message);
    if (!r.data?.length) return failed("pause-autopilot", `no client named ${slug}`);
    return NextResponse.redirect(new URL(`/admin/clients/${slug}`, req.url));
  }

  if (action === "freeze-arm") {
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const r = await adminSb.schema("outreach").from("bandit_arms").update({
      active: false, freeze_reason: `admin_${user.email ?? user.id}`,
    }).eq("id", Number(id)).select("id");
    if (r.error) return failed("freeze-arm", r.error.message);
    if (!r.data?.length) return failed("freeze-arm", `no arm with id ${id}`);
    return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/admin", req.url));
  }

  if (action === "force-topup") {
    const slug = url.searchParams.get("slug");
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    // Was fire-and-forget: a refused or unreachable strategist looked exactly like a
    // successful top-up, and the admin only found out by the leads never arriving.
    const trigger = process.env.STRATEGIST_TRIGGER_URL ?? "https://sswebhook.figura-studio.com/strategist/trigger/outreach-tick";
    const token = process.env.STRATEGIST_WEBHOOK_TOKEN ?? "";
    try {
      const res = await fetch(trigger, { method: "POST", headers: { "x-webhook-token": token }, cache: "no-store" });
      if (!res.ok) return failed("force-topup", `strategist answered ${res.status}`);
    } catch (e) {
      return failed("force-topup", `strategist unreachable: ${String(e).slice(0, 120)}`);
    }
    return NextResponse.redirect(new URL(`/admin/clients/${slug}`, req.url));
  }

  if (action === "cancel-action") {
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const r = await adminSb.schema("outreach").from("lead_actions")
      .update({ status: "cancelled" }).eq("id", Number(id)).select("id");
    if (r.error) return failed("cancel-action", r.error.message);
    if (!r.data?.length) return failed("cancel-action", `no action with id ${id}`);
    return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/admin", req.url));
  }

  return NextResponse.json({ error: "unhandled" }, { status: 500 });
}
