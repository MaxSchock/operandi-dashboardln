import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, Badge, EmptyState } from "@/components/ui";
import { KpiCard } from "@/components/kpi-card";
import { FunnelChart } from "@/components/funnel-chart";
import { ActivitySpark } from "@/components/activity-spark";
import { DateRangePicker } from "@/components/date-range-picker";
import { resolveRange, dayBuckets } from "@/lib/date-range";
import { getClientScope } from "@/lib/scope";
import { getTier, type ClientFeatures } from "@/lib/tier";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EventRow = { occurred_at: string };

async function fetchData(params: { range?: string; since?: string; until?: string }) {
  const range = resolveRange(params, "14d");
  const sb = await createClient();
  const scope = await getClientScope();

  const stateQ = sb.from("lead_state").select("lead_id, current_stage").limit(10000);
  if (scope) stateQ.eq("client_slug", scope);

  // Full event history (no date filter) to build a CUMULATIVE funnel: a lead
  // that has advanced to `messaged` still counts towards accepted/invited, and
  // a lead that later expired keeps the furthest stage it reached.
  const funnelEvQ = sb.from("lead_events").select("lead_id, event_type").limit(50000);
  if (scope) funnelEvQ.eq("client_slug", scope);

  const evCurrQ = sb.from("lead_events")
    .select("occurred_at, event_type")
    .gte("occurred_at", range.sinceIso ?? "1970-01-01")
    .lte("occurred_at", range.untilIso)
    .limit(20000);
  if (scope) evCurrQ.eq("client_slug", scope);

  const evPrev = range.prevSince
    ? (() => {
        const q = sb.from("lead_events")
          .select("occurred_at")
          .gte("occurred_at", range.prevSince!.toISOString())
          .lte("occurred_at", range.prevUntil!.toISOString())
          .limit(20000);
        if (scope) q.eq("client_slug", scope);
        return q;
      })()
    : Promise.resolve({ data: [] as EventRow[] });

  const narratQ = sb.from("weekly_narratives").select("body_md, week_starting, language").order("week_starting", { ascending: false }).limit(1);
  if (scope) narratQ.eq("client_slug", scope);

  const recentQ = sb.from("lead_state")
    .select("lead_id, current_stage, updated_at, leads!inner(id, full_name, headline, company)")
    .in("current_stage", ["replied", "qualified", "accepted"])
    .order("updated_at", { ascending: false })
    .limit(8);
  if (scope) recentQ.eq("client_slug", scope);

  const [states, funnelEv, eventsCurr, eventsPrev, narrativesRes, recentLeadsRes] = await Promise.all([
    stateQ, funnelEvQ, evCurrQ, evPrev, narratQ, recentQ,
  ]);

  const stateRows = (states.data ?? []) as Array<{ lead_id: number; current_stage: string }>;
  const counts: Record<string, number> = {};
  for (const r of stateRows) counts[r.current_stage] = (counts[r.current_stage] ?? 0) + 1;

  // ---- Cumulative funnel: furthest stage each lead ever reached -------------
  const FUNNEL_RANK: Record<string, number> = {
    pre_contact: 0, engaged_post: 1, invited: 2, accepted: 3,
    messaged: 4, replied: 5, qualified: 6,
  };
  const EVENT_RANK: Record<string, number> = {
    post_commented: 1, invite_sent: 2, invite_accepted: 3,
    message_out: 4, message_in: 5, email_replied: 5,
  };
  const FUNNEL_ORDER = ["pre_contact", "engaged_post", "invited", "accepted", "messaged", "replied", "qualified"];

  const maxRank = new Map<number, number>();
  for (const r of stateRows) {
    // current_stage covers terminal/forward stages without events (e.g. qualified);
    // terminal off-funnel stages (expired/opted_out/paused) fall back to events.
    const cr = FUNNEL_RANK[r.current_stage] ?? 0;
    maxRank.set(r.lead_id, Math.max(maxRank.get(r.lead_id) ?? 0, cr));
  }
  for (const e of (funnelEv.data ?? []) as Array<{ lead_id: number; event_type: string }>) {
    const er = EVENT_RANK[e.event_type];
    if (er === undefined) continue;
    maxRank.set(e.lead_id, Math.max(maxRank.get(e.lead_id) ?? 0, er));
  }
  const reached = (rank: number) => {
    let n = 0;
    for (const v of maxRank.values()) if (v >= rank) n++;
    return n;
  };
  const funnel = FUNNEL_ORDER.map((stage, rank) => ({ stage, count: reached(rank) }));
  const reachedByStage: Record<string, number> = Object.fromEntries(funnel.map(f => [f.stage, f.count]));

  const currEvents = (eventsCurr.data ?? []) as EventRow[];
  const prevEvents = (eventsPrev.data ?? []) as EventRow[];
  const deltaEvents = currEvents.length - prevEvents.length;

  // Build per-day series (only if we have a bounded range)
  const series = (() => {
    if (!range.since) return [];
    const buckets = dayBuckets(range.since, range.until);
    const byDay = new Map<string, number>(buckets.map(d => [d, 0]));
    for (const e of currEvents) {
      const k = e.occurred_at.slice(0, 10);
      if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
    }
    return Array.from(byDay.entries()).map(([day, count]) => ({ day: day.slice(5), count }));
  })();

  const recentRaw = (recentLeadsRes.data ?? []) as Array<{
    lead_id: number; current_stage: string; updated_at: string;
    leads: { id: number; full_name: string | null; headline: string | null; company: string | null }
         | Array<{ id: number; full_name: string | null; headline: string | null; company: string | null }>
         | null;
  }>;
  const hot = recentRaw.map(r => {
    const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
    return {
      id: r.lead_id,
      stage: r.current_stage,
      full_name: lead?.full_name ?? "—",
      headline: lead?.headline ?? "",
      company: lead?.company ?? "",
    };
  });

  return {
    range,
    funnel,
    series,
    totalLeads: stateRows.length,
    // KPIs are cumulative too: "Accepted" = leads that ever accepted, not just
    // those still parked in the accepted stage.
    accepted: reachedByStage["accepted"] ?? 0,
    replied: reachedByStage["replied"] ?? 0,
    qualified: reachedByStage["qualified"] ?? 0,
    deltaEvents,
    hot,
    narrative: (narrativesRes.data ?? [])[0],
  };
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  const tier = await getTier();
  const scope = await getClientScope();

  // Pick the view by the EFFECTIVE client (admins follow the scope selector,
  // clients are always their own slug), not by the viewer's role: an admin
  // scoped to a content-only client should see their content overview, not a
  // lead funnel sitting at zero.
  let features = tier.features;
  if (tier.isAdmin && scope) {
    const sb = await createClient();
    const { data } = await sb
      .from("client_features")
      .select("*")
      .eq("client_slug", scope)
      .maybeSingle();
    features = (data as ClientFeatures | null) ?? null;
  }
  const contentOnly = features ? !features.has_outreach && features.has_content : !tier.hasOutreach;
  if (contentOnly) {
    return <ContentOverview slug={tier.isAdmin ? scope : tier.clientSlug} params={params} />;
  }
  const { range, funnel, series, totalLeads, accepted, replied, qualified, deltaEvents, hot, narrative } = await fetchData(params);
  const funnelData = funnel;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">Overview</h1>
          <p className="text-sm text-slate-500">Window: {range.label}</p>
        </div>
        <Suspense><DateRangePicker /></Suspense>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Total leads" value={totalLeads} />
        <KpiCard label="Accepted"    value={accepted}  accent />
        <KpiCard label="Replied"     value={replied}   accent />
        <KpiCard label="Qualified"   value={qualified} accent />
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
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
            action={range.key === "all"
              ? <Badge tone="slate">—</Badge>
              : <Badge tone={deltaEvents >= 0 ? "green" : "red"}>{deltaEvents >= 0 ? "+" : ""}{deltaEvents} vs prev</Badge>
            }
          />
          <CardBody>
            {series.length > 0
              ? <ActivitySpark data={series} />
              : <EmptyState title="Pick a bounded range to chart activity" />
            }
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Hot leads" hint="Recently replied, accepted or qualified" action={
            <Link href="/leads" className="inline-flex items-center gap-1 text-xs text-electric hover:underline">
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
                <div className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-slate-700">{narrative.body_md}</div>
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

type ContentCalRow = {
  content_name: string | null;
  post_type: string | null;
  text_content: string | null;
  text_status: string | null;
  image_status: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  linkedin_url: string | null;
  engagement: {
    reactions?: number; comments?: number; reposts?: number; impressions?: number; score?: number;
    audience?: { icp?: number; total?: number } | null;
  } | null;
};

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Berlin" });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });
}

/**
 * Overview for content-only clients: their posting pipeline and engagement,
 * instead of a lead funnel that would sit at zero.
 */
async function ContentOverview({ slug, params }: { slug: string | null; params: Record<string, string> }) {
  const range = resolveRange(params, "30d");
  const sb = await createClient();
  let q = sb
    .from("content_calendar")
    .select("content_name, post_type, text_content, text_status, image_status, scheduled_for, published_at, linkedin_url, engagement")
    .order("scheduled_for", { ascending: false })
    .limit(500);
  // RLS already confines clients to their own rows; the filter matters for
  // admins, whose view spans every client.
  if (slug) q = q.eq("outreach_slug", slug);
  const { data } = await q;
  const posts = (data ?? []) as ContentCalRow[];

  const inRange = (iso: string, since: Date | null, until: Date) => {
    const t = new Date(iso).getTime();
    return (!since || t >= since.getTime()) && t <= until.getTime();
  };
  const published = posts.filter(p => p.published_at);
  const curr = published
    .filter(p => inRange(p.published_at!, range.since, range.until))
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const prev = range.prevSince
    ? published.filter(p => inRange(p.published_at!, range.prevSince, range.prevUntil!))
    : null;

  // Engagement jsonb is the latest cumulative snapshot per post, so KPIs read
  // as "engagement of the posts published in this window".
  const sum = (rows: ContentCalRow[]) => {
    const s = { posts: rows.length, impressions: 0, engagements: 0, icp: 0, sampled: 0 };
    for (const p of rows) {
      const e = p.engagement;
      if (!e) continue;
      s.impressions += e.impressions ?? 0;
      s.engagements += (e.reactions ?? 0) + (e.comments ?? 0) + (e.reposts ?? 0);
      s.icp += e.audience?.icp ?? 0;
      s.sampled += e.audience?.total ?? 0;
    }
    return s;
  };
  const kc = sum(curr);
  const kp = prev ? sum(prev) : null;

  const now = new Date();
  const upcoming = posts
    .filter(p => !p.published_at && p.scheduled_for && new Date(p.scheduled_for) >= now)
    .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));
  const next = upcoming[0] ?? null;

  // A post is "waiting" while anything still blocks publication: text not yet
  // approved, or (for image posts) the image not yet approved — image approval
  // is a hard requirement of the publisher, not cosmetic.
  const waiting = posts.flatMap(p => {
    if (p.published_at || p.text_status === "Suspended") return [];
    const textPending = !!p.text_status && p.text_status !== "Approved";
    const imagePending = p.post_type === "Image" && p.image_status !== "Approved" && p.image_status !== "Published";
    if (!textPending && !imagePending) return [];
    return [{ post: p, reason: textPending ? (p.text_status ?? "New") : "Image pending" }];
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">Overview</h1>
          <p className="text-sm text-slate-500">Window: {range.label}</p>
        </div>
        <Suspense><DateRangePicker defaultKey="30d" /></Suspense>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Published posts" value={kc.posts} delta={kp ? kc.posts - kp.posts : undefined} />
        <KpiCard label="Impressions" value={kc.impressions} delta={kp ? kc.impressions - kp.impressions : undefined} accent />
        <KpiCard
          label="Engagements"
          value={kc.engagements}
          delta={kp ? kc.engagements - kp.engagements : undefined}
          accent
          hint="Reactions + comments + reposts"
        />
        <KpiCard
          label="ICP engagers"
          value={kc.icp}
          delta={kp ? kc.icp - kp.icp : undefined}
          accent
          hint={kc.sampled > 0 ? `${Math.round((kc.icp / kc.sampled) * 100)}% of sampled engagers` : undefined}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader
            title="Post performance"
            hint="Published in this window, newest first"
            action={next?.scheduled_for ? <Badge tone="slate">Next: {fmtDateTime(next.scheduled_for)}</Badge> : undefined}
          />
          <CardBody className="p-0">
            {curr.length === 0 ? (
              <EmptyState
                title="No posts published in this window"
                hint={next ? "The next post is already scheduled." : "Widen the date range to see older posts."}
              />
            ) : (
              <ul className="divide-y">
                {curr.slice(0, 8).map((p, i) => {
                  const e = p.engagement;
                  const row = (
                    <>
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-700">{(p.text_content ?? "").slice(0, 80) || "(no text)"}</div>
                        <div className="mt-0.5 text-xs text-slate-400">{fmtDay(p.published_at!)}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs text-slate-500">
                        <div><span className="font-medium text-slate-700">{e?.impressions ?? 0}</span> impressions</div>
                        <div>{(e?.reactions ?? 0) + (e?.comments ?? 0) + (e?.reposts ?? 0)} engagements · {e?.audience?.icp ?? 0} ICP</div>
                      </div>
                    </>
                  );
                  return (
                    <li key={i}>
                      {p.linkedin_url ? (
                        <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                          {row}
                        </a>
                      ) : (
                        <div className="flex items-center justify-between gap-3 px-5 py-3">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Waiting for your review"
            hint={`${waiting.length} post${waiting.length === 1 ? "" : "s"}`}
            action={
              <Link href="/content" className="inline-flex items-center gap-1 text-xs text-electric hover:underline">
                Review in Content <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <CardBody className="p-0">
            {waiting.length === 0 ? (
              <EmptyState title="All caught up" hint="Posts that need your approval will show up here." />
            ) : (
              <ul className="divide-y">
                {waiting.slice(0, 6).map(({ post: p, reason }, i) => (
                  <li key={i} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate text-sm text-slate-700">
                        {(p.text_content ?? "").slice(0, 90) || "(no text yet)"}
                      </div>
                      <Badge tone="amber">{reason}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
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
