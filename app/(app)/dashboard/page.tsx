import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, Badge, EmptyState } from "@/components/ui";
import { KpiCard } from "@/components/kpi-card";
import { FunnelChart } from "@/components/funnel-chart";
import { ActivitySpark } from "@/components/activity-spark";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StageRow = { current_stage: string };
type EventRow = { occurred_at: string; event_type: string; channel: string; lead_id: number };
type LeadRow = { id: number; full_name: string | null; headline: string | null; company: string | null };

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function fetchData() {
  const sb = await createClient();

  const since14 = daysAgo(13).toISOString();
  const since7 = daysAgo(6).toISOString();

  const [states, eventsTotal, eventsWindow, narrativesRes, recentLeadsRes] = await Promise.all([
    sb.from("lead_state").select("current_stage").limit(10000),
    sb.from("lead_events").select("occurred_at, event_type, channel, lead_id").gte("occurred_at", since14).limit(5000),
    sb.from("lead_events").select("event_type, occurred_at").gte("occurred_at", since7).limit(5000),
    sb.from("weekly_narratives").select("body_md, week_starting, language").order("week_starting", { ascending: false }).limit(1),
    sb.from("lead_state")
      .select("lead_id, current_stage, updated_at, leads!inner(id, full_name, headline, company)")
      .in("current_stage", ["replied", "qualified", "accepted"])
      .order("updated_at", { ascending: false })
      .limit(8),
  ]);

  const states14d = (states.data ?? []) as StageRow[];
  const events14 = (eventsTotal.data ?? []) as EventRow[];

  // Counts by stage
  const counts: Record<string, number> = {};
  for (const r of states14d) counts[r.current_stage] = (counts[r.current_stage] ?? 0) + 1;

  // Daily activity series
  const byDay = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const k = daysAgo(i).toISOString().slice(0, 10);
    byDay.set(k, 0);
  }
  for (const e of events14) {
    const k = e.occurred_at.slice(0, 10);
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const series = Array.from(byDay.entries()).map(([day, count]) => ({ day: day.slice(5), count }));

  // KPI deltas: this 7d vs prev 7d using events
  const win7 = (eventsWindow.data ?? []) as { event_type: string }[];
  const prev7Count = events14.length - win7.length;
  const deltaTotalEvents = win7.length - prev7Count;

  const totalLeads = states14d.length;
  const accepted = counts["accepted"] ?? 0;
  const replied = counts["replied"] ?? 0;
  const qualified = counts["qualified"] ?? 0;

  // Recent hot leads (replied + qualified)
  const recentRaw = (recentLeadsRes.data ?? []) as Array<{
    lead_id: number;
    current_stage: string;
    updated_at: string;
    leads: { id: number; full_name: string | null; headline: string | null; company: string | null } | LeadRow[] | null;
  }>;
  const hot = recentRaw.map(r => {
    const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
    return {
      id: r.lead_id,
      stage: r.current_stage,
      updated_at: r.updated_at,
      full_name: lead?.full_name ?? "—",
      headline: lead?.headline ?? "",
      company: lead?.company ?? "",
    };
  });

  const narrative = (narrativesRes.data ?? [])[0];

  return { counts, series, totalLeads, accepted, replied, qualified, deltaTotalEvents, hot, narrative };
}

export default async function OverviewPage() {
  const { counts, series, totalLeads, accepted, replied, qualified, deltaTotalEvents, hot, narrative } = await fetchData();
  const funnelData = Object.entries(counts).map(([current_stage, count]) => ({ current_stage, count }));

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-2xl text-navy">Overview</h1>
          <p className="text-sm text-slate-500">Last 14 days. Refreshed on load.</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Total leads"   value={totalLeads} />
        <KpiCard label="Accepted"      value={accepted}   accent />
        <KpiCard label="Replied"       value={replied}    accent delta={null} />
        <KpiCard label="Qualified"     value={qualified}  accent />
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader title="Pipeline funnel" hint="Conversion shown vs previous stage" />
          <CardBody>
            <FunnelChart data={funnelData} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Activity"
            hint="Events per day"
            action={<Badge tone={deltaTotalEvents >= 0 ? "green" : "red"}>{deltaTotalEvents >= 0 ? "+" : ""}{deltaTotalEvents} vs prev 7d</Badge>}
          />
          <CardBody>
            <ActivitySpark data={series} />
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Hot leads" hint="Recently replied, accepted or qualified" action={
            <Link href="/leads" className="text-xs text-electric hover:underline inline-flex items-center gap-1">
              All leads <ArrowRight className="h-3 w-3" />
            </Link>
          } />
          <CardBody className="p-0">
            {hot.length === 0 ? (
              <EmptyState title="No recent activity yet" hint="Once a lead replies or moves stage, it'll show up here." />
            ) : (
              <ul className="divide-y">
                {hot.map(l => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">{l.full_name}</div>
                        <div className="truncate text-xs text-slate-500">
                          {l.headline}{l.company ? ` · ${l.company}` : ""}
                        </div>
                      </div>
                      <StageBadge stage={l.stage} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="What the system learned" hint="Auto-generated weekly summary" />
          <CardBody>
            {narrative ? (
              <>
                <div className="text-xs text-slate-400">Week of {narrative.week_starting}</div>
                <div className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{narrative.body_md}</div>
              </>
            ) : (
              <EmptyState title="No summary yet" hint="The first weekly narrative is generated Monday 04:00." />
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const tone =
    stage === "qualified" ? "green" :
    stage === "replied"   ? "electric" :
    stage === "accepted"  ? "amber" : "slate";
  return <Badge tone={tone as "slate" | "green" | "amber" | "red" | "electric"}>{stage.replace("_", " ")}</Badge>;
}
