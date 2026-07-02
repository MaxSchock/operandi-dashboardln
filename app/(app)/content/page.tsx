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
  content_slug: string;
  content_name: string | null;
  outreach_slug: string | null;
  post_id: string;
  sheet_row: number | null;
  post_type: string | null;
  text_content: string | null;
  text_status: string | null;
  image_status: string | null;
  text_notes?: string | null;
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
  content_slug: string;
  content_name: string | null;
  outreach_slug: string | null;
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
const POSTS_PER_CLIENT = 12;

function pct(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isNaN(n) ? "—" : `${Math.round(n * 100)}%`;
}

function GeneratePanel({ slug, name }: { slug: string; name: string }) {
  return (
    <Card>
      <CardHeader title={`Generate posts · ${name}`} hint="on demand" />
      <CardBody>
        <form action={`/api/admin/content-generate/${slug}`} method="post" className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Number of posts</label>
            <input
              type="number"
              name="count"
              defaultValue={3}
              min={1}
              max={10}
              className="w-16 rounded-md border bg-white px-2 py-1 text-sm text-slate-700"
            />
          </div>
          <fieldset className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="mode" value="auto" defaultChecked /> Let the agent pick the topics
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="mode" value="manual" /> I&apos;ll provide the topics
            </label>
          </fieldset>
          <div>
            <label className="text-xs text-slate-500">
              Topics (one per line, only if you provide them)
            </label>
            <textarea
              name="topics"
              rows={3}
              placeholder="one topic per line"
              className="mt-1 w-full rounded-md border bg-white px-2 py-1 text-sm text-slate-700"
            />
          </div>
          <div className="flex items-center gap-3">
            <button className="rounded-md bg-electric px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
              Generate
            </button>
            <span className="text-xs text-slate-400">
              Posts appear in a few minutes. Refresh the page.
            </span>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export default async function ContentPage() {
  const sb = await createClient();
  const scope = await getClientScope();
  const { data: { user } } = await sb.auth.getUser();

  const [{ data: calData }, { data: anData }, { data: userInfo }] = await Promise.all([
    sb.from("content_calendar").select("*").order("scheduled_for", { ascending: false }).limit(500),
    sb.from("content_analytics").select("*"),
    user ? sb.from("client_users").select("role").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  let posts = (calData ?? []) as CalendarRow[];
  let analytics = (anData ?? []) as AnalyticsRow[];
  const isAdmin = (userInfo as { role?: string } | null)?.role === "operandi_admin";

  if (scope) {
    posts = posts.filter(p => p.outreach_slug === scope);
    analytics = analytics.filter(a => a.outreach_slug === scope);
  }

  const postsByClient = new Map<string, CalendarRow[]>();
  for (const p of posts) {
    const arr = postsByClient.get(p.content_slug) ?? [];
    arr.push(p);
    postsByClient.set(p.content_slug, arr);
  }

  const clientSlugs = new Set<string>([...analytics.map(a => a.content_slug), ...postsByClient.keys()]);
  const sections = [...clientSlugs].map(slug => {
    const a = analytics.find(x => x.content_slug === slug);
    const cp = postsByClient.get(slug) ?? [];
    return { slug, name: a?.content_name ?? cp[0]?.content_name ?? slug, analytics: a, posts: cp };
  }).sort((x, y) => (y.posts.length - x.posts.length) || x.name.localeCompare(y.name));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Content</h1>
        <p className="text-sm text-slate-500">
          Per client: what the engine learned, and every post (full text + image) with its reach and
          ICP-fit. Admins can approve, edit, request a revision, or suspend each post.
        </p>
      </header>

      {sections.length === 0 ? (
        <Card><CardBody><EmptyState title="No content clients in scope" /></CardBody></Card>
      ) : (
        sections.map(s => (
          <div key={s.slug} className="space-y-3">
            {isAdmin && <GeneratePanel slug={s.slug} name={s.name} />}
            <AnalyticsPanel name={s.name} a={s.analytics} />
            <Card>
              <CardHeader title={`Posts · ${s.name}`} hint={`${s.posts.length} post${s.posts.length === 1 ? "" : "s"}`} />
              <CardBody className="space-y-4">
                {s.posts.length === 0 ? (
                  <EmptyState title="No posts yet" />
                ) : (
                  <>
                    {s.posts.slice(0, POSTS_PER_CLIENT).map(r => <PostCard key={r.post_id} r={r} isAdmin={isAdmin} />)}
                    {s.posts.length > POSTS_PER_CLIENT && (
                      <div className="text-center text-xs text-slate-400">+ {s.posts.length - POSTS_PER_CLIENT} more</div>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        ))
      )}
    </div>
  );
}

function AnalyticsPanel({ name, a }: { name: string; a?: AnalyticsRow }) {
  const topicFit = Object.entries(a?.topic_icp_fit ?? {}).sort((x, y) => y[1] - x[1]);
  const hasData = !!a && (a.avg_icp_pct !== null || topicFit.length > 0 ||
    (a.distilled_rules?.length ?? 0) > 0 || (a.hard_negatives?.length ?? 0) > 0);

  return (
    <Card>
      <CardHeader
        title={`Analytics · ${name}`}
        hint={a?.computed_at ? `learned ${new Date(a.computed_at).toLocaleDateString()}` : "no learning run yet"}
      />
      <CardBody className="space-y-5">
        {!hasData ? (
          <EmptyState title="No analytics yet"
            hint="Metrics and ICP-fit appear after the nightly learn job runs on published posts." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Avg ICP-fit" value={pct(a!.avg_icp_pct)} accent />
              <Kpi label="First-pass rate (30d)" value={pct(a!.first_pass_rate_30d)} />
              <Kpi label="Topics tracked" value={String(Object.keys(a!.topic_weights ?? {}).length)} />
              <Kpi label="Regression" value={a!.regression_alert ? "⚠ yes" : "ok"} bad={!!a!.regression_alert} />
            </div>
            {a!.regression_alert && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                Engagement regression: recent avg {a!.regression_alert.ma_short} vs baseline {a!.regression_alert.ma_long}
                {" "}(ratio {a!.regression_alert.ratio}). Since {new Date(a!.regression_alert.since).toLocaleDateString()}.
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
            {(a!.distilled_rules?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Learned style rules</div>
                <ul className="space-y-1 text-xs text-slate-600">
                  {a!.distilled_rules!.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}
            {(a!.hard_negatives?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Hard negatives (never do)</div>
                <ul className="space-y-1 text-xs text-red-700">
                  {a!.hard_negatives!.map((r, i) => <li key={i}>• {r}</li>)}
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

function PostCard({ r, isAdmin }: { r: CalendarRow; isAdmin: boolean }) {
  const status = r.published_at ? "Published" : (r.text_status ?? "New");
  const img = r.image_url_imgbb || r.image_url_source;
  const when = r.published_at || r.scheduled_for;
  const e = r.engagement;
  const aud = e?.audience ?? null;
  const canManage = isAdmin && status !== "Published" && r.sheet_row != null;
  const act = `/api/admin/content-post/${r.content_slug}/${r.sheet_row}`;
  const schedDate = r.scheduled_for ? new Date(r.scheduled_for).toISOString().slice(0, 10) : "";

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {img ? (
          <a href={img} target="_blank" rel="noreferrer" className="shrink-0">
            <img src={img} alt="post" className="h-40 w-40 rounded-md border object-cover" />
          </a>
        ) : (
          <div className="grid h-40 w-40 shrink-0 place-items-center rounded-md border border-dashed bg-slate-50 text-[10px] text-slate-400">
            no image
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Badge tone={STATUS_TONE[status] ?? "slate"}>{status}</Badge>
            {!r.published_at && r.scheduled_for && new Date(r.scheduled_for) < new Date() && (
              <Badge tone="amber">⚠ overdue ({new Date(r.scheduled_for).toLocaleDateString()}) — publishes immediately if approved</Badge>
            )}
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
          {/* Full post text, readable (scrolls if very long) */}
          <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">{r.text_content ?? "(no text)"}</pre>
          {r.linkedin_url && (
            <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-electric hover:underline">
              View on LinkedIn ↗
            </a>
          )}
        </div>
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap items-start gap-2 border-t pt-3">
          <form action={`${act}?action=approve`} method="post">
            <button className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:opacity-90">Approve</button>
          </form>

          <form action={`${act}?action=set-date`} method="post" className="flex items-center gap-1.5">
            <input type="date" name="date" defaultValue={schedDate}
              className="rounded-md border bg-white px-2 py-1 text-xs text-slate-700" />
            <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Save date</button>
          </form>

          <details className="group">
            <summary className="cursor-pointer list-none rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Edit text</summary>
            <form action={`${act}?action=edit-text`} method="post" className="mt-2 w-80 max-w-full">
              <textarea name="text" defaultValue={r.text_content ?? ""} rows={6}
                className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
              <button className="mt-1 rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90">Save text</button>
            </form>
          </details>

          <details className="group">
            <summary className="cursor-pointer list-none rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Revise text</summary>
            <form action={`${act}?action=revise-text`} method="post" className="mt-2 w-80 max-w-full">
              <textarea name="notes" rows={3} placeholder="What to change about the text (the engine regenerates it)"
                className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
              <button className="mt-1 rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:opacity-90">Request text revision</button>
            </form>
          </details>

          <details className="group">
            <summary className="cursor-pointer list-none rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Revise image</summary>
            <form action={`${act}?action=revise-image`} method="post" className="mt-2 w-80 max-w-full">
              <textarea name="notes" rows={3} placeholder="What to change about the image (the engine regenerates it)"
                className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
              <button className="mt-1 rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:opacity-90">Request image revision</button>
            </form>
          </details>

          <form action={`${act}?action=suspend`} method="post" className="ml-auto">
            <button className="rounded-md bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200">Suspend</button>
          </form>
        </div>
      )}
    </div>
  );
}
