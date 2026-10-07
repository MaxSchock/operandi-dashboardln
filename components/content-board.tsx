"use client";
/* eslint-disable @next/next/no-img-element */

import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import type { AnalyticsRow, CalendarRow, CommentDraftRow, ContentData } from "@/lib/content-load";

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  Published: "green", Approved: "electric", New: "slate",
  "Under review": "amber", "In progress": "amber", Suspended: "red",
};
const POSTS_PER_CLIENT = 12;
/** The engine picked the post up (or is about to): text or image is being made again. */
const REMAKING = new Set(["Under review", "In progress"]);
/** How long the places kept for freshly requested posts wait before giving up. */
const GENERATE_WAIT_MS = 20 * 60 * 1000;

// One zone and one notation on the server and in the browser: the same string
// in both renders, and the zone the engine schedules in.
const ZONE = "Europe/Berlin";
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: ZONE, dateStyle: "short", timeStyle: "short" });
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: ZONE, dateStyle: "short" });
const num = (v: number) => v.toLocaleString("en-GB");

function pct(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isNaN(n) ? "—" : `${Math.round(n * 100)}%`;
}

/** Something is being made: a turning wheel and what it is, inline or, with
 * `box`, in the place the result will take. */
function Working({ text, box }: { text: string; box?: boolean }) {
  return (
    <div role="status" aria-live="polite" data-testid="working"
      className={`flex items-center gap-2 text-[11px] text-amber-700 ${box ? "h-40 w-40 shrink-0 flex-col justify-center rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 text-center leading-4" : ""}`}>
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

type Outcome = { ok: boolean; error?: string; body: Record<string, unknown> };

/** Every action of this page: a POST that answers with data, never a trip back to the page. */
async function post(url: string, form?: FormData): Promise<Outcome> {
  try {
    const res = await fetch(url, { method: "POST", headers: { accept: "application/json" }, body: form });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(body.error ?? `failed (${res.status})`), body };
    return { ok: true, body };
  } catch {
    return { ok: false, error: "No connection. Try again in a moment.", body: {} };
  }
}

/** Rows that did not change keep the object they had, so their cards are not drawn again. */
function keep<T>(prev: T[], fresh: T[], id: (x: T) => string): T[] {
  const before = new Map(prev.map(x => [id(x), x]));
  return fresh.map(x => {
    const old = before.get(id(x));
    return old && JSON.stringify(old) === JSON.stringify(x) ? old : x;
  });
}

type Queued = { n: number; known: string[]; until: number };

export function ContentBoard({ data: served }: { data: ContentData }) {
  // What is shown: the server's render first, then whatever the background
  // request brings. Nothing here loads the page again.
  const [data, setData] = useState(served);
  useEffect(() => { setData(served); }, [served]);
  // Posts asked for and not yet written, per content client: their places are kept.
  const [queued, setQueued] = useState<Record<string, Queued>>({});
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch("/api/content", { cache: "no-store" });
      if (!res.ok || mine !== seq.current) return;
      const fresh = await res.json() as ContentData;
      if (mine !== seq.current) return;
      setData(prev => JSON.stringify(prev) === JSON.stringify(fresh) ? prev : {
        ...fresh,
        posts: keep(prev.posts, fresh.posts, p => p.post_id),
        drafts: keep(prev.drafts, fresh.drafts, d => d.id),
        analytics: keep(prev.analytics, fresh.analytics, a => a.content_slug),
      });
    } catch { /* the next tick asks again */ }
  }, []);

  const { isAdmin, ownSlug, posts, analytics, drafts } = data;
  const waiting = (slug: string) => {
    const q = queued[slug];
    if (!q) return 0;
    const arrived = posts.filter(p => p.content_slug === slug && !q.known.includes(p.post_id)).length;
    return Math.max(0, q.n - arrived);
  };
  const working = posts.some(p => !p.published_at && (REMAKING.has(p.text_status ?? "") || REMAKING.has(p.image_status ?? "")))
    || Object.keys(queued).some(slug => waiting(slug) > 0);

  // Often while something is being made, seldom otherwise (a post published by
  // the engine, a new comment). Not at all while the tab is hidden.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      setQueued(q => {
        const live = Object.entries(q).filter(([, v]) => v.until > Date.now());
        return live.length === Object.keys(q).length ? q : Object.fromEntries(live);
      });
      void reload();
    }, working ? 5000 : 30000);
    return () => clearInterval(t);
  }, [working, reload]);

  // `n` posts are still to come for this client, counted from the posts it has now.
  const onQueued = useCallback((slug: string, n: number, known: string[]) => {
    setQueued(q => ({ ...q, [slug]: { n, known, until: Date.now() + GENERATE_WAIT_MS } }));
    void reload();
  }, [reload]);

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

  if (sections.length === 0) return <Card><CardBody><EmptyState title="No content clients in scope" /></CardBody></Card>;

  return (
    <>
      {sections.map(s => {
        const sectionIsOwn = ownSlug != null && (s.posts[0]?.outreach_slug ?? s.analytics?.outreach_slug) === ownSlug;
        const places = waiting(s.slug);
        return (
          <div key={s.slug} className="space-y-3" data-testid={`content-${s.slug}`}>
            {(isAdmin || sectionIsOwn) && (
              <GeneratePanel slug={s.slug} name={s.name} maxCount={isAdmin ? 10 : 6}
                onQueued={n => onQueued(s.slug, places + n, s.posts.map(p => p.post_id))} />
            )}
            <AnalyticsPanel name={s.name} a={s.analytics} posts={s.posts} showInternals={isAdmin || sectionIsOwn} />
            {(isAdmin || sectionIsOwn) && (
              <CommentDraftsPanel slug={s.slug} name={s.name} error={data.draftsError}
                drafts={drafts.filter(d => d.content_slug === s.slug)} onDone={reload} />
            )}
            <Card>
              <CardHeader title={`Posts · ${s.name}`} hint={`${s.posts.length} post${s.posts.length === 1 ? "" : "s"}`} />
              <CardBody className="space-y-4">
                {Array.from({ length: places }, (_, i) => (
                  <div key={`queued-${i}`} className="flex flex-col gap-4 rounded-lg border border-dashed border-amber-300 p-4 sm:flex-row" data-testid="post-queued">
                    <Working box text="The image comes after the text." />
                    <Working text={`A new post is being written${places > 1 ? ` (${i + 1} of ${places})` : ""}. It appears here in a few minutes.`} />
                  </div>
                ))}
                {s.posts.length === 0 && places === 0 ? (
                  <EmptyState title="No posts yet" />
                ) : (
                  <>
                    {s.posts.slice(0, POSTS_PER_CLIENT).map(r => <PostCard key={r.post_id} r={r} isAdmin={isAdmin} ownSlug={ownSlug} onDone={reload} />)}
                    {s.posts.length > POSTS_PER_CLIENT && (
                      <details className="group">
                        <summary className="cursor-pointer list-none rounded-md border border-dashed py-2 text-center text-xs font-medium text-electric hover:bg-slate-50">
                          Show {s.posts.length - POSTS_PER_CLIENT} more <span className="group-open:hidden">▾</span><span className="hidden group-open:inline">▴</span>
                        </summary>
                        <div className="mt-4 space-y-4">
                          {s.posts.slice(POSTS_PER_CLIENT).map(r => <PostCard key={r.post_id} r={r} isAdmin={isAdmin} ownSlug={ownSlug} onDone={reload} />)}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        );
      })}
    </>
  );
}

/* ---------- generate ---------- */

type QueuedNote = { queued: number; topics: number; dropped: number; textOnly: boolean };

function GeneratePanel({ slug, name, maxCount, onQueued }: { slug: string; name: string; maxCount: number; onQueued: (n: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Say what was queued: a topic list that had been cut or dropped must not
  // look exactly like a good run.
  const [note, setNote] = useState<QueuedNote | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setError(null); setNote(null);
    const out = await post(`/api/admin/content-generate/${slug}`, new FormData(form));
    setBusy(false);
    if (!out.ok) { setError(out.error ?? "failed"); return; }
    const b = out.body as Partial<QueuedNote>;
    const queued = Number(b.queued ?? 0);
    setNote({ queued, topics: Number(b.topics ?? 0), dropped: Number(b.dropped ?? 0), textOnly: b.textOnly === true });
    form.reset();
    onQueued(queued);
  }
  return (
    <Card>
      <CardHeader title={`Generate posts · ${name}`} hint="on demand" />
      <CardBody>
        <form onSubmit={submit} className="space-y-3" data-testid="generate-form">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Number of posts</label>
            <input type="number" name="count" defaultValue={3} min={1} max={maxCount}
              className="w-16 rounded-md border bg-white px-2 py-1 text-sm text-slate-700" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Topics — leave empty and the agent picks them</label>
            <textarea name="topics" rows={4}
              placeholder={"One idea per line. Write full sentences if you want to: commas never split an idea.\nFor an idea that needs several lines, separate the ideas with an empty line."}
              className="mt-1 w-full rounded-md border bg-white px-2 py-1 text-sm text-slate-700" />
            <p className="mt-1 text-xs text-slate-400">
              One post per idea. What you write here decides what the post is about; voice,
              structure and length stay as configured.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="text_only" value="1" /> Without image (text-only posts)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={busy} className="rounded-md bg-electric px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">
              {busy ? "Sending..." : "Generate"}
            </button>
            {!note && !error && <span className="text-xs text-slate-400">Posts appear below by themselves in a few minutes.</span>}
          </div>
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-testid="generate-error"><span className="font-medium">That didn&apos;t work: </span>{error}</div>}
          {note && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-testid="generate-queued">
              <span className="font-medium">{note.queued} post{note.queued === 1 ? "" : "s"} queued</span>
              {note.topics > 0 ? ` from ${note.topics} topic${note.topics === 1 ? "" : "s"} you provided.` : ", with topics picked by the agent."}
              {note.textOnly && " Text only, no image."}
              {" They appear below by themselves in a few minutes."}
              {note.topics > 0 && note.queued > note.topics ? ` (${note.queued} posts for ${note.topics} topics: the extra posts reuse them in turn.)` : ""}
              {note.dropped > 0 && (
                <span className="font-medium">
                  {` ${note.dropped} more topic${note.dropped === 1 ? " was" : "s were"} NOT used:`}
                  {` this request tops out at ${note.queued} posts. Send them again in a second batch.`}
                </span>
              )}
            </div>
          )}
        </form>
      </CardBody>
    </Card>
  );
}

/* ---------- comment replies ---------- */

function CommentDraftsPanel({ slug, name, drafts, error, onDone }: { slug: string; name: string; drafts: CommentDraftRow[]; error: string | null; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const open = drafts.filter(d => d.action !== "draft_done");
  // Closed in the last 3 days stay reachable: "mark as posted" is one click and clicking
  // it by mistake used to bury the comment for good (Codex, 2026-09-02).
  const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  const closed = drafts.filter(d => d.action === "draft_done" && new Date(d.created_at).getTime() >= cutoff);
  async function mark(id: string, action: "done" | "reopen") {
    setBusy(id); setFailed(null);
    const out = await post(`/api/admin/content-comment/${id}?action=${action}`);
    if (!out.ok) setFailed(out.error ?? "failed");
    await onDone();
    setBusy(null);
  }
  return (
    <Card>
      <div id={`comments-${slug}`} className="scroll-mt-4" />
      <CardHeader
        title={`Comment replies to post by hand · ${name}`}
        hint={error ? "could not load" : open.length === 0 ? "nothing waiting" : `${open.length} waiting`}
      />
      <CardBody className="space-y-3">
        <p className="text-xs text-slate-500">
          The engine drafts a reply for each new comment but does not post it (LinkedIn treats tool-posted replies as
          automated). Copy the draft, paste it under the comment on LinkedIn, then mark it done. Edit freely before posting.
        </p>
        {failed && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"><span className="font-medium">That didn&apos;t work: </span>{failed}</div>}
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Could not load the drafts ({error}). There may be comments waiting; it is tried again by itself.
          </div>
        ) : open.length === 0 ? (
          <EmptyState title="No comments waiting for a reply" />
        ) : open.map(d => (
          <div key={d.id} className="space-y-2 rounded-lg border p-3" data-testid="comment-draft">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{d.comment_author || "Unknown"}</span>
              {d.comment_type && <Badge tone="slate">{d.comment_type}</Badge>}
              <span>{dateTime(d.created_at)}</span>
              {d.linkedin_url && (
                <a href={d.linkedin_url} target="_blank" rel="noreferrer" className="text-electric hover:underline">
                  open post{d.sheet_row != null ? ` (row ${d.sheet_row})` : ""}
                </a>
              )}
            </div>
            <blockquote className="whitespace-pre-wrap border-l-2 border-slate-200 pl-3 text-sm text-slate-600">{d.comment_text}</blockquote>
            <div className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-sm text-slate-800">{d.reply_text}</div>
            <div className="flex items-center gap-2">
              <CopyButton text={d.reply_text ?? ""} label="Copy reply" />
              <button type="button" disabled={busy === d.id} onClick={() => mark(d.id, "done")}
                className="rounded-md bg-electric px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">
                {busy === d.id ? "Saving..." : "Mark as posted"}</button>
            </div>
          </div>
        ))}
        {closed.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none rounded-md border border-dashed py-2 text-center text-xs font-medium text-slate-500 hover:bg-slate-50">
              {closed.length} marked as posted in the last 3 days
              <span className="group-open:hidden"> ▾</span><span className="hidden group-open:inline"> ▴</span>
            </summary>
            <div className="mt-3 space-y-2">
              {closed.map(d => (
                <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-600">{d.comment_author || "Unknown"}</span>
                  <span className="truncate">{(d.comment_text ?? "").slice(0, 70)}</span>
                  <button type="button" disabled={busy === d.id} onClick={() => mark(d.id, "reopen")}
                    className="ml-auto rounded-md border px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Put back</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

/* ---------- analytics ---------- */

function engagementSummary(posts: CalendarRow[]) {
  let published = 0, scheduled = 0, impressions = 0, reactions = 0, comments = 0,
    reposts = 0, icp = 0, totalScore = 0, scored = 0, best = 0;
  for (const p of posts) {
    if (p.published_at) published++;
    else if (p.scheduled_for) scheduled++;
    const e = p.engagement;
    if (!e) continue;
    impressions += e.impressions ?? 0;
    reactions += e.reactions ?? 0;
    comments += e.comments ?? 0;
    reposts += e.reposts ?? 0;
    icp += e.audience?.icp ?? 0;
    if (typeof e.score === "number") { totalScore += e.score; scored++; best = Math.max(best, e.score); }
  }
  return { published, scheduled, impressions, reactions, comments, reposts, icp,
    avgScore: scored ? totalScore / scored : null, best, scored };
}

function AnalyticsPanel({ name, a, posts, showInternals }: { name: string; a?: AnalyticsRow; posts: CalendarRow[]; showInternals: boolean }) {
  const topicFit = Object.entries(a?.topic_icp_fit ?? {}).sort((x, y) => y[1] - x[1]);
  const s = engagementSummary(posts);
  const hasEngagement = s.published > 0 || s.scored > 0;
  // Learning internals (rules, hard negatives, regression, topic weights) are
  // operator tooling; clients only see engagement numbers.
  const hasLearned = showInternals && !!a && (a.avg_icp_pct !== null || topicFit.length > 0 ||
    (a.distilled_rules?.length ?? 0) > 0 || (a.hard_negatives?.length ?? 0) > 0);

  return (
    <Card>
      <CardHeader
        title={`Analytics · ${name}`}
        hint={a?.computed_at ? `learned ${dateOnly(a.computed_at)}` : "no learning run yet"}
      />
      <CardBody className="space-y-5">
        {!hasEngagement && !hasLearned ? (
          <EmptyState title="No analytics yet"
            hint="Metrics and ICP-fit appear after the nightly learn job runs on published posts." />
        ) : (
          <>
            {hasEngagement && (
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">Engagement · all posts</div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                  <Kpi label="Published" value={String(s.published)} />
                  <Kpi label="Scheduled" value={String(s.scheduled)} />
                  <Kpi label="ICP engagers" value={String(s.icp)} accent />
                  <Kpi label="Impressions" value={num(s.impressions)} />
                  <Kpi label="Reactions" value={String(s.reactions)} />
                  <Kpi label="Comments" value={String(s.comments)} />
                  <Kpi label="Reposts" value={String(s.reposts)} />
                  <Kpi label="Avg / best score" value={s.avgScore === null ? "—" : `${s.avgScore.toFixed(1)} / ${s.best}`} />
                </div>
              </div>
            )}
            {hasLearned && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Avg ICP-fit" value={pct(a!.avg_icp_pct)} accent />
                <Kpi label="First-pass rate (30d)" value={pct(a!.first_pass_rate_30d)} />
                <Kpi label="Topics tracked" value={String(Object.keys(a!.topic_weights ?? {}).length)} />
                <Kpi label="Regression" value={a!.regression_alert ? "⚠ yes" : "ok"} bad={!!a!.regression_alert} />
              </div>
            )}
            {showInternals && a?.regression_alert && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                Engagement regression: recent avg {a.regression_alert.ma_short} vs baseline {a.regression_alert.ma_long}
                {" "}(ratio {a.regression_alert.ratio}). Since {dateOnly(a.regression_alert.since)}.
              </div>
            )}
            {showInternals && topicFit.length > 0 && (
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
            {showInternals && (a?.distilled_rules?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Learned style rules</div>
                <ul className="space-y-1 text-xs text-slate-600">
                  {a!.distilled_rules!.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}
            {showInternals && (a?.hard_negatives?.length ?? 0) > 0 && (
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

/* ---------- one post ---------- */

const DONE_NOTE: Record<string, string> = {
  approve: "Approved and scheduled.", "set-date": "Date saved.", "edit-text": "Text saved.",
  "revise-text": "Revision requested: the new text appears here.", "revise-image": "Revision requested: the new image appears here.",
  "upload-image": "Image uploaded. Approve the post to publish it.", "set-post-type": "Saved.", suspend: "Suspended.",
  "reset-published": "Unlocked for editing.",
};

const PostCard = memo(function PostCard({ r, isAdmin, ownSlug, onDone }: { r: CalendarRow; isAdmin: boolean; ownSlug: string | null; onDone: () => Promise<void> }) {
  // The action under way on this card, if any; its outcome is shown on the card.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const img = r.image_url_imgbb || r.image_url_source;
  const textOnly = (r.post_type ?? "").toLowerCase() === "text";
  // A post is only eligible for publish when BOTH sides are approved (publish.py
  // skips image posts whose col F isn't Approved). Deriving the badge from
  // text_status alone showed "Approved" on posts the publisher would never touch.
  const textStatus = r.text_status ?? "New";
  const imageApproved = textOnly || r.image_status === "Approved" || r.image_status === "Published";
  const imagePending = !r.published_at && textStatus === "Approved" && !imageApproved;
  const fullyApproved = textStatus === "Approved" && imageApproved;
  const status = r.published_at ? "Published" : imagePending ? "Under review" : textStatus;
  const live = !r.published_at && textStatus !== "Suspended";
  const textRemaking = live && REMAKING.has(textStatus);
  const imageRemaking = live && !textOnly && (REMAKING.has(r.image_status ?? "") || !img);
  const when = r.published_at || r.scheduled_for;
  const e = r.engagement;
  const aud = e?.audience ?? null;
  const isOwner = ownSlug != null && r.outreach_slug === ownSlug;
  const canManage = (isAdmin || isOwner) && status !== "Published" && r.sheet_row != null;
  const act = `/api/admin/content-post/${r.content_slug}/${r.sheet_row}`;
  // Both date and time prefill must be Berlin: the daemon reads post_date as naive
  // Europe/Berlin local, and (since Approve now round-trips the picker) an ISO/UTC date
  // slice could land the wrong calendar day for posts scheduled near midnight.
  const schedDate = r.scheduled_for ? new Date(r.scheduled_for).toLocaleDateString("en-CA", { timeZone: ZONE }) : "";
  const schedTime = r.scheduled_for
    ? new Date(r.scheduled_for).toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false })
    : "";

  async function run(action: string, form: FormData, panel?: HTMLDetailsElement | null): Promise<boolean> {
    // Row-identity guard: the daemon refuses the action if this post_id no longer
    // lives at this sheet_row (suspended-row cleanup shifts rows underneath users).
    form.set("post_id", r.post_id);
    setBusy(action); setError(null); setDone(null);
    const out = await post(`${act}?action=${action}`, form);
    if (out.ok) { setDone(DONE_NOTE[action] ?? "Saved."); if (panel) panel.open = false; }
    else setError(out.error ?? "failed");
    await onDone();
    setBusy(null);
    return out.ok;
  }
  /** A form of this card: its fields go with the action named on the button pressed. */
  const submit = (fallback: string, clear = false) => (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const pressed = (ev.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(form);
    void run(pressed?.dataset.action ?? fallback, data, form.closest("details")).then(ok => { if (ok && clear) form.reset(); });
  };
  const off = busy !== null;
  const summary = "cursor-pointer list-none rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200";

  return (
    <div id={`post-${r.content_slug}-${r.sheet_row}`} className="scroll-mt-4 rounded-lg border p-4" data-testid="post-card" data-post={r.post_id}>
      <div className="flex flex-col gap-4 sm:flex-row">
        {busy === "upload-image" ? (
          <Working box text="Your image is being uploaded." />
        ) : imageRemaking ? (
          <Working box text={img ? "A new image is being drawn. It appears here in a few minutes." : "The image is being drawn. It appears here in a few minutes."} />
        ) : img ? (
          <a href={img} target="_blank" rel="noreferrer" className="shrink-0">
            <img src={img} alt="post" className="h-40 w-40 rounded-md border object-cover" />
          </a>
        ) : textOnly ? (
          <div className="grid h-40 w-40 shrink-0 place-items-center rounded-md border border-dashed bg-slate-50 text-center text-[10px] leading-4 text-slate-400">
            <span>text-only<br />post<br /><span className="text-slate-300">(no image by design)</span></span>
          </div>
        ) : (
          <div className="grid h-40 w-40 shrink-0 place-items-center rounded-md border border-dashed bg-slate-50 text-center text-[10px] leading-4 text-slate-400">
            no image
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Badge tone={STATUS_TONE[status] ?? "slate"}>{status}</Badge>
            {r.linkedin_deleted_at && <Badge tone="red">deleted on LinkedIn</Badge>}
            {textOnly && <Badge tone="slate">Text-only</Badge>}
            {imagePending && !imageRemaking && <Badge tone="amber">new image — approve to publish</Badge>}
            {!r.published_at && r.scheduled_for && new Date(r.scheduled_for) < new Date() && (
              <Badge tone="amber">⚠ overdue ({dateOnly(r.scheduled_for)}) — {fullyApproved ? "publishes on the next run" : "approve to publish"}</Badge>
            )}
            {r.pain_label && <Badge tone="electric">{r.pain_label.slice(0, 40)}</Badge>}
            {aud?.icp_pct !== undefined && aud?.total ? (
              <Badge tone="green">{pct(aud.icp_pct)} ICP ({aud.icp}/{aud.total})</Badge>
            ) : null}
            <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400" data-testid="post-when">
              {when ? dateTime(when) : "—"}
            </span>
          </div>
          {e && (e.score || e.reactions || e.impressions) ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span className="font-medium text-navy">score {e.score ?? 0}</span>
              <span>👍 {e.reactions ?? 0}</span>
              <span>💬 {e.comments ?? 0}</span>
              <span>🔁 {e.reposts ?? 0}</span>
              {typeof e.impressions === "number" && <span>📊 {num(e.impressions)} impr.</span>}
            </div>
          ) : status === "Published" ? (
            <div className="mt-2 text-xs text-slate-400">metrics pending nightly sync</div>
          ) : null}
          {textRemaking && <div className="mt-3"><Working text="The text is being rewritten. The new one appears here in a few minutes." /></div>}
          {/* Full post text, readable (scrolls if very long) */}
          <pre className={`mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700 ${textRemaking ? "opacity-50" : ""}`} data-testid="post-text">{r.text_content ?? "(no text)"}</pre>
          {r.linkedin_url && (
            <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-electric hover:underline">
              View on LinkedIn ↗
            </a>
          )}
        </div>
      </div>

      {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-testid="post-error"><span className="font-medium">That didn&apos;t work: </span>{error}</div>}
      {busy && busy !== "upload-image" && <div className="mt-3"><Working text="Saving..." /></div>}
      {!busy && !error && done && <div className="mt-3 text-[11px] text-emerald-700" role="status" data-testid="post-done">{done}</div>}

      {canManage && (
        <div className="mt-3 flex flex-wrap items-start gap-2 border-t pt-3">
          {/* The date/time picker and Approve share ONE form so the schedule shown in
              the picker is submitted WITH the approval. They used to be two separate
              forms, so editing the picker and clicking Approve (without first clicking
              "Save date") silently dropped the new date and the post kept its old slot
              (Zayd, 2026-07-22). "Save date" reschedules without approving. */}
          <form onSubmit={submit("approve")} className="flex flex-wrap items-center gap-1.5">
            <input type="date" name="date" defaultValue={schedDate} key={`d${schedDate}`}
              className="rounded-md border bg-white px-2 py-1 text-xs text-slate-700" />
            <input type="time" name="time" defaultValue={schedTime} key={`t${schedTime}`}
              className="rounded-md border bg-white px-2 py-1 text-xs text-slate-700" />
            <button disabled={off} data-action="approve" data-testid="post-approve" className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">Approve &amp; schedule</button>
            <button disabled={off} data-action="set-date" data-testid="post-save-date"
              className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40">Save date only</button>
          </form>

          <details className="group">
            <summary className={summary}>Edit text</summary>
            <form onSubmit={submit("edit-text")} className="mt-2 w-80 max-w-full">
              <textarea name="text" defaultValue={r.text_content ?? ""} rows={6}
                className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
              <button disabled={off} className="mt-1 rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">Save text</button>
            </form>
          </details>

          <details className="group">
            <summary className={summary}>Revise text</summary>
            <form onSubmit={submit("revise-text", true)} className="mt-2 w-80 max-w-full">
              <textarea name="notes" rows={3} placeholder="What to change about the text (the engine regenerates it)"
                className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
              <button disabled={off} className="mt-1 rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">Request text revision</button>
            </form>
          </details>

          <details className="group">
            <summary className={summary}>Revise image</summary>
            <form onSubmit={submit("revise-image", true)} className="mt-2 w-80 max-w-full">
              <textarea name="notes" rows={3} placeholder="What to change about the image (the engine regenerates it)"
                className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
              <button disabled={off} className="mt-1 rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">Request image revision</button>
            </form>
          </details>

          <details className="group">
            <summary className={summary}>Upload image</summary>
            <form onSubmit={submit("upload-image", true)} className="mt-2 w-80 max-w-full space-y-1">
              <input type="file" name="image" accept="image/*" required
                className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200" />
              <p className="text-[11px] text-slate-400">Replaces the AI image. The post stays for review, click Approve to publish.</p>
              <button disabled={off} className="mt-1 rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">Upload image</button>
            </form>
          </details>

          {/* Publish without a picture. The engine has always supported it (post_type
              Text skips the attachment and waives the image approval), it was simply
              never exposed: every post ever created was post_type Image. */}
          <form onSubmit={submit("set-post-type")}>
            <input type="hidden" name="post_type" value={textOnly ? "Image" : "Text"} />
            <button disabled={off} className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40">
              {textOnly ? "Publish with image" : "Publish without image"}
            </button>
          </form>

          <form onSubmit={submit("suspend")} className="ml-auto">
            <button disabled={off} className="rounded-md bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-40">Suspend</button>
          </form>
        </div>
      )}

      {(isAdmin || isOwner) && status === "Published" && r.sheet_row != null && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <form onSubmit={submit("reset-published")}>
            <button disabled={off} className="rounded-md bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-40">Fix &amp; republish</button>
          </form>
          <p className="text-[11px] text-slate-400">
            Deleted this post on LinkedIn? This unlocks it for editing so you can fix and re-approve it.
            It checks LinkedIn first and refuses while the post is still live.
          </p>
        </div>
      )}
    </div>
  );
});
