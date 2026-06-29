/* eslint-disable @next/next/no-img-element */
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getClientScope } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Audience = { icp?: number; peer?: number; off?: number; total?: number; icp_pct?: number } | null;
type Engagement = {
  reactions?: number; comments?: number; reposts?: number; impressions?: number; score?: number;
  audience?: Audience;
} | null;

type CalendarRow = {
  post_id: string;
  client_slug: string;
  post_type: string | null;
  text_content: string | null;
  text_status: string | null;
  image_status: string | null;
  topic: string | null;
  pain_id: string | null;
  pain_label: string | null;
  image_url_imgbb: string | null;
  image_url_source: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  linkedin_url: string | null;
  engagement: Engagement;
};

type AnalyticsRow = {
  client_slug: string;
  avg_icp_pct: string | null;
  topic_icp_fit: Record<string, number> | null;
  topic_weights: Record<string, number> | null;
  first_pass_rate_30d: string | null;
  regression_alert: { since: string; ma_short: number; ma_long: number; ratio: number } | null;
  distilled_rules: string[] | null;
  hard_negatives: string[] | null;
  exemplar_posts: { id: string; text: string; topic: string; score: number }[] | null;
  computed_at: string | null;
};

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  Published: "green", Approved: "electric", New: "slate",
  "Under review": "amber", "In progress": "amber", Suspended: "red",
};

function pct(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isNaN(n) ? "—" : `${Math.round(n * 100)}%`;
}

export default async function ContentPage() {
  const sb = await createClient();
  const scope = await getClientScope();

  let calQ = sb.from("content_calendar").select("*").order("scheduled_for", { ascending: false }).limit(200);
  let anQ = sb.from("content_analytics").select("*").order("client_slug");
  if (scope) { calQ = calQ.eq("client_slug", scope); anQ = anQ.eq("client_slug", scope); }
  const [{ data: calData }, { data: anData }] = await Promise.all([calQ, anQ]);
  const rows = (calData ?? []) as CalendarRow[];
  const analytics = (anData ?? []) as AnalyticsRow[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Content</h1>
        <p className="text-sm text-slate-500">
          Posts, their reach and how well they pull the ICP, plus what the engine has learned.
          Each post is themed on a pain point; engagement on it feeds the Warm DMs queue.
        </p>
      </header>

      {analytics.map(a => <AnalyticsPanel key={a.client_slug} a={a} />)}

      <Card>
        <CardHeader title="Calendar & post metrics" hint={`${rows.length} post${rows.length === 1 ? "" : "s"}`} />
        <CardBody className="space-y-4">
          {rows.length === 0 ? (
            <EmptyState title="No content yet" hint="Posts prepared by the content engine will show here." />
          ) : (
            rows.map(r => <PostCard key={r.post_id} r={r} />)
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function AnalyticsPanel({ a }: { a: AnalyticsRow }) {
  const topicFit = Object.entries(a.topic_icp_fit ?? {}).sort((x, y) => y[1] - x[1]);
  const hasData = a.avg_icp_pct !== null || topicFit.length > 0 ||
    (a.distilled_rules?.length ?? 0) > 0 || (a.hard_negatives?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader
        title={`Analytics · ${a.client_slug}`}
        hint={a.computed_at ? `learned ${new Date(a.computed_at).toLocaleDateString()}` : "no learning run yet"}
      />
      <CardBody className="space-y-5">
        {!hasData ? (
          <EmptyState title="No analytics yet"
            hint="Metrics and ICP-fit appear after the nightly learn job runs on published posts." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Avg ICP-fit" value={pct(a.avg_icp_pct)} accent />
              <Kpi label="First-pass rate (30d)" value={pct(a.first_pass_rate_30d)} />
              <Kpi label="Cadence" value="see brief" />
              <Kpi label="Regression" value={a.regression_alert ? "⚠ yes" : "ok"} bad={!!a.regression_alert} />
            </div>

            {a.regression_alert && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                Engagement regression: recent avg {a.regression_alert.ma_short} vs baseline {a.regression_alert.ma_long}
                {" "}(ratio {a.regression_alert.ratio}). Since {new Date(a.regression_alert.since).toLocaleDateString()}.
              </div>
            )}

            {topicFit.length > 0 && (
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">ICP-fit by topic</div>
                <div className="space-y-1.5">
                  {topicFit.map(([topic, v]) => (
                    <div key={topic} className="flex items-center gap-2">
                      <div className="w-1/2 truncate text-xs text-slate-600" title={topic}>{topic}</div>
                      <div className="relative h-3 flex-1 rounded bg-slate-100">
                        <div className="absolute inset-y-0 left-0 rounded bg-electric"
                          style={{ width: `${Math.min(100, Math.round(v * 100))}%` }} />
                      </div>
                      <div className="w-10 text-right text-xs tabular-nums text-slate-500">{pct(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(a.distilled_rules?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Learned style rules</div>
                <ul className="space-y-1 text-xs text-slate-600">
                  {a.distilled_rules!.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}

            {(a.hard_negatives?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Hard negatives (never do)</div>
                <ul className="space-y-1 text-xs text-red-700">
                  {a.hard_negatives!.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Kpi({ label, value, accent, bad }: { label: string; value: string; accent?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 font-display text-lg ${bad ? "text-amber-600" : accent ? "text-electric" : "text-navy"}`}>{value}</div>
    </div>
  );
}

function PostCard({ r }: { r: CalendarRow }) {
  const status = r.published_at ? "Published" : (r.text_status ?? "New");
  const img = r.image_url_imgbb || r.image_url_source;
  const when = r.published_at || r.scheduled_for;
  const e = r.engagement;
  const aud = e?.audience ?? null;
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row">
      {img ? (
        <a href={img} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={img} alt="post" className="h-32 w-32 rounded-md border object-cover" />
        </a>
      ) : (
        <div className="grid h-32 w-32 shrink-0 place-items-center rounded-md border border-dashed bg-slate-50 text-[10px] text-slate-400">
          no image
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone={STATUS_TONE[status] ?? "slate"}>{status}</Badge>
          {r.pain_label && <Badge tone="electric">{r.pain_label.slice(0, 40)}</Badge>}
          {aud?.icp_pct !== undefined && aud?.total ? (
            <Badge tone="green">{pct(aud.icp_pct)} ICP ({aud.icp}/{aud.total})</Badge>
          ) : null}
          <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400">
            {when ? new Date(when).toLocaleString() : "—"}
          </span>
        </div>

        {e && (e.score || e.reactions || e.impressions) ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="font-medium text-navy">score {e.score ?? 0}</span>
            <span>👍 {e.reactions ?? 0}</span>
            <span>💬 {e.comments ?? 0}</span>
            <span>🔁 {e.reposts ?? 0}</span>
            {typeof e.impressions === "number" && <span>📊 {e.impressions.toLocaleString()} impr.</span>}
          </div>
        ) : status === "Published" ? (
          <div className="mt-2 text-xs text-slate-400">metrics pending nightly sync</div>
        ) : null}

        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-700">
          {r.text_content ?? "(no text)"}
        </p>
        {r.linkedin_url && (
          <a href={r.linkedin_url} target="_blank" rel="noreferrer"
            className="mt-2 inline-block text-xs text-electric hover:underline">
            View on LinkedIn ↗
          </a>
        )}
      </div>
    </div>
  );
}
