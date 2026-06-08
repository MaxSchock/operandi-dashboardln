import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Health = {
  status: "ok" | "degraded" | "down";
  generated_at: string;
  checks: Record<string, unknown>;
};

/**
 * Inline equivalent of /api/health, but executed with the user's RLS
 * session cookies (server fetch wouldn't carry them — that was the 500).
 */
async function computeHealth(): Promise<Health> {
  const checks: Record<string, unknown> = {};
  let status: Health["status"] = "ok";

  try {
    const sb = await createClient();
    const { data: isAdmin, error: adminErr } = await sb.rpc("current_user_is_admin");
    checks["supabase_rpc"] = adminErr
      ? { ok: false, error: adminErr.message }
      : { ok: true, is_admin: !!isAdmin };
    if (adminErr) status = "degraded";

    const { data: lastAction } = await sb
      .from("lead_actions")
      .select("id, created_at, status, action_type")
      .order("created_at", { ascending: false })
      .limit(1);
    checks["last_action"] = lastAction?.[0] ?? null;

    const { data: lastEvent } = await sb
      .from("lead_events")
      .select("id, channel, event_type, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(1);
    checks["last_event"] = lastEvent?.[0] ?? null;

    const { data: arms } = await sb
      .from("bandit_arms")
      .select("client_slug, dimension, key, active, observations");
    checks["bandit_arms_total"] = arms?.length ?? 0;
    checks["bandit_arms_active"] = arms?.filter((a: { active: boolean }) => a.active).length ?? 0;

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

  return { status, checks, generated_at: new Date().toISOString() };
}

export default async function HealthPage() {
  const h = await computeHealth();

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-2xl text-navy">System health</h1>
          <p className="text-sm text-slate-500">Generated {new Date(h.generated_at).toLocaleString()}</p>
        </div>
        <Badge tone={h.status === "ok" ? "green" : h.status === "degraded" ? "amber" : "red"}>{h.status}</Badge>
      </header>

      <Card>
        <CardHeader title="Diagnostics" />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(h.checks).map(([k, v]) => (
                <tr key={k} className="border-t">
                  <td className="w-1/3 px-5 py-3 font-medium text-slate-700">{k}</td>
                  <td className="px-5 py-3 text-slate-600">
                    <pre className="whitespace-pre-wrap text-xs">{typeof v === "object" ? JSON.stringify(v, null, 2) : String(v)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
