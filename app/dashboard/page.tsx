import { createClient } from "@/lib/supabase/server";
import { FunnelChart } from "@/components/funnel-chart";
import { KpiCard } from "@/components/kpi-card";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";  // KPIs change frequently
export const revalidate = 0;

type StageCount = { current_stage: string; count: number };

async function fetchData() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Stage funnel (RLS filters to client_slug automatically)
  const { data: states } = await sb
    .from("lead_state")
    .select("current_stage")
    .limit(10000);

  const counts: Record<string, number> = {};
  for (const s of states ?? []) counts[s.current_stage] = (counts[s.current_stage] ?? 0) + 1;

  const stages = [
    "pre_contact", "engaged_post", "invited", "accepted",
    "messaged", "replied", "qualified",
  ];
  const funnel: StageCount[] = stages.map(s => ({ current_stage: s, count: counts[s] ?? 0 }));

  // Latest weekly narrative
  const { data: narratives } = await sb
    .from("weekly_narratives")
    .select("body_md, week_starting, language")
    .order("week_starting", { ascending: false })
    .limit(1);
  const narrative = narratives?.[0];

  return { funnel, narrative, totalLeads: states?.length ?? 0 };
}

export default async function DashboardPage() {
  const { funnel, narrative, totalLeads } = await fetchData();

  const qualified = funnel.find(f => f.current_stage === "qualified")?.count ?? 0;
  const replied = funnel.find(f => f.current_stage === "replied")?.count ?? 0;
  const accepted = funnel.find(f => f.current_stage === "accepted")?.count ?? 0;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Outreach pipeline</h1>
          <p className="text-sm text-slate-500">Live data. Refreshed every minute.</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Total leads" value={totalLeads} />
        <KpiCard label="Accepted" value={accepted} accent />
        <KpiCard label="Replied" value={replied} accent />
        <KpiCard label="Qualified" value={qualified} accent />
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="font-display text-xl text-navy">Funnel</h2>
        <FunnelChart data={funnel} />
      </section>

      {narrative && (
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-display text-xl text-navy">What the system learned this week</h2>
          <p className="mt-1 text-xs text-slate-400">Week of {narrative.week_starting} · {narrative.language}</p>
          <div className="prose mt-4 max-w-none whitespace-pre-line text-slate-700">{narrative.body_md}</div>
        </section>
      )}
    </main>
  );
}
