import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StateRow = { client_slug: string; current_stage: string };

const STAGES = ["pre_contact", "engaged_post", "invited", "accepted", "messaged", "replied", "qualified"];

export default async function AdminHome() {
  const sb = await createClient();
  const { data } = await sb.from("lead_state").select("client_slug, current_stage").limit(50000);
  const states = (data ?? []) as StateRow[];

  const byClient: Record<string, Record<string, number>> = {};
  for (const r of states) {
    byClient[r.client_slug] ??= {};
    byClient[r.client_slug][r.current_stage] = (byClient[r.client_slug][r.current_stage] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Admin · Cross-client view</h1>
        <p className="text-sm text-slate-500">Only visible to operandi_admin. Override controls inside each client.</p>
      </header>

      <Card>
        <CardHeader title="Funnel per client" />
        <CardBody className="p-0 overflow-x-auto">
          {Object.keys(byClient).length === 0 ? (
            <EmptyState title="No leads in any client yet" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Client</th>
                  {STAGES.map(s => <th key={s} className="px-3 py-3">{s.replace("_", " ")}</th>)}
                  <th className="px-3 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byClient).map(([slug, counts]) => (
                  <tr key={slug} className="border-t hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <Link href={`/admin/clients/${slug}`} className="font-medium text-navy hover:underline">{slug}</Link>
                    </td>
                    {STAGES.map(s => <td key={s} className="px-3 py-2.5 text-slate-600">{counts[s] ?? 0}</td>)}
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">
                      {Object.values(counts).reduce((a, b) => a + b, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-slate-400">
        Per-client overrides: pause autopilot, freeze bandit arm, force Apollo top-up, cancel pending action.
        Available inside each client page. <Badge tone="slate">v2 admin</Badge>
      </p>
    </div>
  );
}
