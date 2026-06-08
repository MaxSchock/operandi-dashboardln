import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Reports the dashboard's view of the outreach v2 backend:
 *   - Supabase reachable + RLS pings
 *   - Last decisor tick (max created_at on lead_actions)
 *   - Latest webhook event (max occurred_at on lead_events)
 *   - Bandit arm count per active dimension
 *
 * Always returns 200 so it's cheap to ping; the JSON `status` field is
 * "ok" / "degraded" / "down".
 */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let status: "ok" | "degraded" | "down" = "ok";

  try {
    const sb = await createClient();

    // Supabase + RLS round-trip via current_user_is_admin function
    const { data: isAdmin, error: adminErr } = await sb.rpc("current_user_is_admin");
    checks["supabase_rpc"] = adminErr ? { ok: false, error: adminErr.message } : { ok: true, is_admin: !!isAdmin };
    if (adminErr) status = "degraded";

    // Last action created (a stand-in for "last decisor tick")
    const { data: lastAction } = await sb
      .from("lead_actions")
      .select("id, created_at, status, action_type")
      .order("created_at", { ascending: false })
      .limit(1);
    checks["last_action"] = lastAction?.[0] ?? null;

    // Last event ingested
    const { data: lastEvent } = await sb
      .from("lead_events")
      .select("id, channel, event_type, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(1);
    checks["last_event"] = lastEvent?.[0] ?? null;

    // Bandit arm summary
    const { data: arms } = await sb
      .from("bandit_arms")
      .select("client_slug, dimension, key, active, observations");
    checks["bandit_arms_total"] = arms?.length ?? 0;
    checks["bandit_arms_active"] = arms?.filter((a: { active: boolean }) => a.active).length ?? 0;

    // Decisor staleness: degraded if no action in last 60 min and we have active autopilot clients
    if (lastAction?.[0]?.created_at) {
      const ageMin = (Date.now() - new Date(lastAction[0].created_at).getTime()) / 60000;
      checks["last_action_age_minutes"] = Math.round(ageMin);
      if (ageMin > 60) status = "degraded";
    } else {
      checks["last_action_age_minutes"] = null;
    }
  } catch (e) {
    status = "down";
    checks["error"] = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({ status, checks, generated_at: new Date().toISOString() });
}
