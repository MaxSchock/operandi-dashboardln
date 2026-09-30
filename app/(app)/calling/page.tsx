import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";
import { LockedPanel } from "@/components/locked-panel";
import { CallLogForm, TimeZoneCookie } from "@/components/call-log-form";
import {
  LINKEDIN_LABEL, OUTCOME_LABEL, OUTCOME_TONE, STAGE_LABEL, TABS, TAB_LABEL,
  DEFAULT_CALL_HINT, endOfTodayIso, fmtWhen, latestReply, leadLocale, localTime, ts, orgPhone, orgSize, replyUnhandled, sizeBucket, stageOf, websiteHref,
  type CallingConfig, type CallingStage, type CallingState, type CallingTab, type Enrichment,
} from "@/lib/calling";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LeadInfo = {
  id: number;
  full_name: string | null;
  headline: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  source_batch: string | null;
  country: string | null;
  timezone: string | null;
  language: string | null;
  email_bounced_at: string | null;
  enrichment: Enrichment;
};

type Row = {
  lead_id: number;
  client_slug: string;
  current_stage: string;
  last_inbound_at: string | null;
  updated_at: string;
  channel_state: { calling?: CallingState; li?: unknown } | null;
  leads: LeadInfo[] | LeadInfo | null;
};

type DraftRow = {
  id: number;
  sequence_id: number;
  lead_id: number;
  client_slug: string;
  step: number;
  subject: string;
  body: string;
  status: string;
  error: string | null;
  created_at: string;
  lead: { full_name: string | null; email: string | null; company: string | null } | { full_name: string | null; email: string | null; company: string | null }[] | null;
};

type CallEvent = { lead_id: number; occurred_at: string; payload: { outcome?: string; notes?: string; by?: string } | null };
type SeqRow = { id: number; lead_id: number; status: string; step: number; total_steps: number; next_send_at: string | null; stopped_reason: string | null; created_at: string };
type SentRow = { lead_id: number; sequence_id: number; step: number; subject: string; sent_at: string | null; status: string };

/** Everything the page knows about one lead, computed once. */
type View = {
  r: Row;
  l: LeadInfo;
  cs: CallingState | undefined;
  stage: CallingStage;
  reply: { at: string; channel: "email" | "linkedin" } | null;
  replyOpen: boolean;
  bounced: boolean;
  callbackDue: boolean;
  meetingToday: boolean;
  calls: CallEvent[];
  seq: SeqRow | null;
  sent: SentRow[];
};

function leadOf(r: Row): LeadInfo | null {
  if (!r.leads) return null;
  return Array.isArray(r.leads) ? (r.leads[0] ?? null) : r.leads;
}
function leadOfDraft(d: DraftRow) {
  if (!d.lead) return null;
  return Array.isArray(d.lead) ? (d.lead[0] ?? null) : d.lead;
}

const SIZE_FILTERS = ["all", "5-20", "21-50", "51+", "1-4", "unknown"] as const;

const NOTICE_COPY: Record<string, string> = {
  "nurture:drafted": "Call saved. Email 1 is drafted in Today, read it and approve to send.",
  "nurture:no_email": "Call saved, but this lead has no email address, so no follow-up email was opened. Add the address on the next call.",
  "nurture:no_consent": "Call saved. No email was drafted because they did not say yes to an email.",
  "nurture:sequence_exists": "Call saved. A follow-up sequence is already open for this lead.",
  "nurture:draft_failed": "Call saved, but the email draft could not be written. Try again from the card.",
  "call:bad_email": "Not saved: that email address does not look right.",
  "email:sent": "Email sent from your mailbox.",
  "email:queued": "Approved. It goes out in the next sending window.",
  "email:rejected": "Draft rejected, sequence stopped.",
  "email:stopped": "Sequence stopped.",
  "email:no_email_account": "Your mailbox is not connected yet, nothing was sent. Ask Max for the connection link.",
  "email:inbound_unanswered": "Not sent: they already wrote to you. Reply by hand, the sequence is stopped.",
  "email:already_messaged": "Not sent: you already emailed this person by hand. Continue that thread yourself.",
  "email:provider_unreachable": "Not sent: the mailbox could not be reached. Nothing went out, try again later.",
  "email:daily_quota_reached": "Not sent: today's email cap is reached. It will go out tomorrow.",
  "email:mailbox_paused": "Not sent: follow-up emails are paused because too many bounced. See Settings.",
  "email:bounced": "Not sent: this address bounced. Get the right one on the next call.",
};
function noticeCopy(raw: string | undefined): string | null {
  if (!raw) return null;
  return NOTICE_COPY[raw] ?? raw.replace(/^[a-z_]+:/, "").replace(/_/g, " ");
}

export default async function CallingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const tier = await getTier();
  if (!tier.hasLeads) {
    return (
      <div className="space-y-6">
        <header><h1 className="font-display text-2xl text-navy">Calling</h1></header>
        <LockedPanel feature="leads" />
      </div>
    );
  }
  const params = await searchParams;
  const tab: CallingTab = (TABS as readonly string[]).includes(params.tab ?? "") ? (params.tab as CallingTab) : "today";
  const q = (params.q ?? "").trim().toLowerCase();
  const scope = await getClientScope();
  const client = params.client ?? scope ?? (tier.isAdmin ? "all" : (tier.clientSlug ?? "all"));
  const notice = noticeCopy(params.notice);
  const tz = decodeURIComponent((await cookies()).get("tz")?.value ?? "") || "Europe/London";
  const endOfToday = endOfTodayIso(tz);
  const startOfToday = new Date(new Date(endOfToday).getTime() - 86_400_000).toISOString();

  const sb = await createClient();
  let qCfg = sb.from("calling_config").select("*");
  if (client !== "all") qCfg = qCfg.eq("client_slug", client);
  const { data: cfgRows } = await qCfg;
  const cfgBy = new Map(((cfgRows ?? []) as CallingConfig[]).map(c => [c.client_slug, c]));
  const clientCfg = client !== "all" ? (cfgBy.get(client) ?? null) : null;
  const size = (SIZE_FILTERS as readonly string[]).includes(params.size ?? "")
    ? params.size!
    : ((SIZE_FILTERS as readonly string[]).includes(clientCfg?.default_size ?? "") ? clientCfg!.default_size : "all");
  const select = "lead_id, client_slug, current_stage, last_inbound_at, updated_at, channel_state, leads!inner(id, full_name, headline, company, email, phone, role, source_batch, country, timezone, language, email_bounced_at, enrichment)";
  let qCalling = sb.from("lead_state").select(select).not("channel_state->calling", "is", null)
    .order("updated_at", { ascending: false }).limit(1000);
  // Leads that were sourced for LinkedIn but fit the calling profile (phone + 5-20 people)
  // are shown too, so nothing already paid for goes to waste. Logging a call on one of
  // them creates its calling state.
  let qLegacy = sb.from("lead_state").select(select).is("channel_state->calling", null)
    .in("current_stage", ["pre_contact", "paused"]).order("updated_at", { ascending: false }).limit(800);
  let qDrafts = sb.from("email_messages")
    .select("id, sequence_id, lead_id, client_slug, step, subject, body, status, error, created_at, lead:leads(full_name, email, company)")
    .in("status", ["draft", "approved", "failed"]).order("created_at", { ascending: false }).limit(50);
  let qCalls = sb.from("lead_events").select("lead_id, occurred_at, payload")
    .eq("event_type", "call_outcome").order("occurred_at", { ascending: false }).limit(3000);
  let qSeqs = sb.from("email_sequences").select("id, lead_id, status, step, total_steps, next_send_at, stopped_reason, created_at")
    .order("created_at", { ascending: false }).limit(2000);
  let qSent = sb.from("email_messages").select("lead_id, sequence_id, step, subject, sent_at, status")
    .eq("status", "sent").order("sent_at", { ascending: false }).limit(3000);
  if (client !== "all") {
    qCalling = qCalling.eq("client_slug", client); qLegacy = qLegacy.eq("client_slug", client);
    qDrafts = qDrafts.eq("client_slug", client); qCalls = qCalls.eq("client_slug", client);
    qSeqs = qSeqs.eq("client_slug", client); qSent = qSent.eq("client_slug", client);
  }

  const [{ data: callingRows }, { data: legacyRows }, { data: draftRows }, { data: callRows }, { data: seqRows }, { data: sentRows }] =
    await Promise.all([qCalling, qLegacy, qDrafts, qCalls, qSeqs, qSent]);
  const legacy = ((legacyRows ?? []) as unknown as Row[]).filter(r => {
    const l = leadOf(r);
    return l && orgPhone(l) && sizeBucket(orgSize(l)) === "5-20";
  });

  const callsBy = groupBy((callRows ?? []) as CallEvent[], c => c.lead_id);
  const sentBy = groupBy((sentRows ?? []) as SentRow[], s => s.lead_id);
  const seqBy = new Map<number, SeqRow>();
  for (const s of (seqRows ?? []) as SeqRow[]) if (!seqBy.has(s.lead_id)) seqBy.set(s.lead_id, s);

  const views: View[] = [...((callingRows ?? []) as unknown as Row[]), ...legacy].flatMap(r => {
    const l = leadOf(r);
    if (!l) return [];
    const cs = r.channel_state?.calling;
    const stage = stageOf(cs, r.current_stage);
    const reply = latestReply(cs, r);
    return [{
      r, l, cs, stage, reply,
      replyOpen: stage !== "closed" && replyUnhandled(cs, reply),
      bounced: stage !== "closed" && !!l.email_bounced_at,
      callbackDue: stage !== "closed" && !!cs?.callback_at && ts(cs.callback_at) < ts(endOfToday),
      meetingToday: stage === "meeting" && !!cs?.meeting_at && ts(cs.meeting_at) >= ts(startOfToday) && ts(cs.meeting_at) < ts(endOfToday),
      calls: callsBy.get(r.lead_id) ?? [],
      seq: seqBy.get(r.lead_id) ?? null,
      sent: (sentBy.get(r.lead_id) ?? []).slice().reverse(),
    }];
  });

  const matches = (v: View) => {
    if (size !== "all" && sizeBucket(orgSize(v.l)) !== size) return false;
    if (q) {
      const org = v.l.enrichment?.organization;
      const hay = `${v.l.full_name ?? ""} ${v.l.company ?? ""} ${org?.industry ?? ""} ${org?.city ?? ""} ${v.l.email ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const inTab = (v: View, t: CallingTab) =>
    t === "today" ? (v.replyOpen || v.bounced || v.callbackDue || v.meetingToday) : v.stage === t;

  const filtered = views.filter(matches);
  const drafts = ((draftRows ?? []) as unknown as DraftRow[]);
  const counts = Object.fromEntries(TABS.map(t => [t, filtered.filter(v => inTab(v, t)).length])) as Record<CallingTab, number>;
  const rows = filtered.filter(v => inTab(v, tab)).sort(sorter(tab));

  const todayKey = new Date().toISOString().slice(0, 10);
  const calledToday = ((callRows ?? []) as CallEvent[]).filter(c => c.occurred_at.startsWith(todayKey)).length;
  const clientsSeen = Array.from(new Set(views.map(v => v.r.client_slug))).sort();
  const uploadClient = client !== "all" ? client : (clientsSeen[0] ?? "zayd");
  const qs = (t: CallingTab) => {
    const p = new URLSearchParams();
    p.set("tab", t);
    if (params.q) p.set("q", params.q);
    if (params.size) p.set("size", size);
    if (params.client) p.set("client", params.client);
    return `?${p.toString()}`;
  };
  const replies = filtered.filter(v => v.replyOpen).length;
  const dueCalls = filtered.filter(v => v.callbackDue).length;

  return (
    <div className="space-y-6">
      <TimeZoneCookie />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">Calling</h1>
          <p className="text-sm text-slate-500">
            Phone first, nothing automated before the call. Today shows what needs you now:
            call-backs that are due, replies nobody has handled, emails waiting for approval and today&apos;s meetings.
          </p>
          {clientCfg?.compliance_note && (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600"><span className="font-medium">Before you call: </span>{clientCfg.compliance_note}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="electric">{calledToday} called today</Badge>
          {replies > 0 && <Badge tone="green">{replies} repl{replies === 1 ? "y" : "ies"} waiting</Badge>}
          {dueCalls > 0 && <Badge tone="red">{dueCalls} call-back{dueCalls === 1 ? "" : "s"} due</Badge>}
          {tier.canOperate && client !== "all" && (
            <a href={`/calling/settings?client=${encodeURIComponent(client)}`} className="text-electric hover:underline">Settings</a>
          )}
        </div>
      </header>

      {notice && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{notice}</div>
      )}

      <nav className="flex flex-wrap gap-1 border-b">
        {TABS.map(t => {
          const n = t === "today" ? counts.today + drafts.length : counts[t];
          return (
            <a key={t} href={qs(t)}
              className={`-mb-px rounded-t-md border px-3 py-2 text-sm ${t === tab ? "border-b-white bg-white font-medium text-navy" : "border-transparent text-slate-500 hover:text-navy"}`}>
              {TAB_LABEL[t]} <span className={`ml-1 rounded-full px-1.5 text-xs ${t === "today" && n > 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{n}</span>
            </a>
          );
        })}
      </nav>

      {tab === "today" && drafts.length > 0 && (
        <Card>
          <CardHeader title="Emails waiting for you" hint={`${drafts.length} draft${drafts.length === 1 ? "" : "s"} · email 1 of each sequence needs your approval, the following ones go out on their own`} />
          <CardBody className="space-y-4">
            {drafts.map(d => <DraftCard key={d.id} d={d} canOperate={tier.canOperate} />)}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <form method="get" className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_9rem_9rem_5rem]">
            <input type="hidden" name="tab" value={tab} />
            <input name="q" defaultValue={params.q ?? ""} placeholder="Name, company, trade, city, email"
              className="rounded-md border px-3 py-2 text-sm" />
            <select name="size" defaultValue={size} className="rounded-md border px-3 py-2 text-sm">
              {SIZE_FILTERS.map(s => <option key={s} value={s}>{s === "all" ? "Any size" : s === "unknown" ? "Size unknown" : `${s} people`}</option>)}
            </select>
            {tier.isAdmin ? (
              <select name="client" defaultValue={client} className="rounded-md border px-3 py-2 text-sm">
                <option value="all">All clients</option>
                {clientsSeen.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : <input type="hidden" name="client" value={client} />}
            <button className="rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:opacity-90">Go</button>
          </form>
          {tier.canOperate && tab === "to_call" && (
            <div className="mt-4 flex flex-wrap items-start gap-4 border-t pt-4">
              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-electric">Upload your own list (CSV)</summary>
                <form action="/api/calling/upload" method="post" encType="multipart/form-data" className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="file" name="file" accept=".csv,text/csv" required className="text-xs" />
                  <input name="label" placeholder="label (e.g. investors)" className="rounded-md border px-2 py-1 text-xs" />
                  <input type="hidden" name="client" value={uploadClient} />
                  <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Upload &amp; enrich</button>
                  <span className="text-[10px] text-slate-400">Columns: name, company, email, linkedin, phone, website, notes. Max 500 rows. Apollo fills the gaps.</span>
                </form>
              </details>
              {tier.isAdmin && (
                <form action={`/api/calling/topup?slug=${encodeURIComponent(uploadClient)}&target=100`} method="post">
                  <button className="rounded-md border border-electric px-3 py-1 text-xs font-medium text-electric hover:bg-electric/5">
                    Top up 100 UK trades ({uploadClient})
                  </button>
                </form>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="space-y-3">
        {rows.length === 0 ? (
          <Card><EmptyState title={tab === "today" ? "Nothing due right now" : `Nobody in ${TAB_LABEL[tab]}`}
            hint={tab === "today" ? "Call-backs, replies and meetings show up here on their day." : "Change the size or search, or look in another tab."} /></Card>
        ) : rows.map(v => <LeadCard key={v.r.lead_id} v={v} tab={tab} tz={tz} canOperate={tier.canOperate} cfg={cfgBy.get(v.r.client_slug) ?? null} />)}
      </div>
    </div>
  );
}

function groupBy<T>(xs: T[], key: (x: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x); else m.set(k, [x]);
  }
  return m;
}

function sorter(tab: CallingTab) {
  return (a: View, b: View) => {
    if (tab === "today") {
      // Replies first (someone is waiting on you), then due call-backs, oldest first.
      if (a.replyOpen !== b.replyOpen) return a.replyOpen ? -1 : 1;
      if (a.bounced !== b.bounced) return a.bounced ? -1 : 1;
      return ts(a.cs?.callback_at ?? a.cs?.meeting_at) - ts(b.cs?.callback_at ?? b.cs?.meeting_at);
    }
    if (tab === "meeting") return (ts(a.cs?.meeting_at) || Infinity) - (ts(b.cs?.meeting_at) || Infinity);
    if (tab === "closed") return ts(b.cs?.last_call_at) - ts(a.cs?.last_call_at);
    // To call / following up: dated call-backs first by date, then fewest calls.
    const ca = a.cs?.callback_at ?? "";
    const cb = b.cs?.callback_at ?? "";
    if (ca && !cb) return -1;
    if (cb && !ca) return 1;
    if (ca && cb) return ts(ca) - ts(cb);
    return (a.cs?.calls ?? 0) - (b.cs?.calls ?? 0);
  };
}

function EmailLine({ v, tz }: { v: View; tz: string }) {
  const s = v.seq;
  if (!s && v.sent.length === 0) return null;
  const next = s && s.status === "active" && s.next_send_at ? fmtWhen(s.next_send_at, tz) : null;
  const statusText = !s ? "" :
    s.status === "pending_approval" ? "email 1 waiting for your approval" :
    s.status === "active" ? `${s.step} of ${s.total_steps} sent${next ? ` · next ${next}` : ""}` :
    s.status === "done" ? `all ${s.total_steps} sent` :
    s.status === "stopped" ? `stopped (${(s.stopped_reason ?? "").replace(/_/g, " ")}) after ${s.step} of ${s.total_steps}` :
    `failed: ${s.stopped_reason ?? ""}`;
  return (
    <div className="text-xs leading-5 text-slate-600">
      <span className="text-slate-400">emails: </span>{statusText}
      {v.sent.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {v.sent.map(m => (
            <li key={`${m.sequence_id}-${m.step}`} className="text-slate-500">
              {fmtWhen(m.sent_at, tz)} · {m.step}. {m.subject}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadCard({ v, tab, tz, canOperate, cfg }: { v: View; tab: CallingTab; tz: string; canOperate: boolean; cfg: CallingConfig | null }) {
  const { r, l, cs, stage } = v;
  const st = cs?.status ?? "queued";
  const org = l.enrichment?.organization ?? null;
  const phone = orgPhone(l);
  const size = orgSize(l);
  const site = websiteHref(org?.website_url);
  const profile = l.enrichment?.profile_url || l.enrichment?.linkedin_url || null;
  const liStage = r.current_stage !== "paused" ? (LINKEDIN_LABEL[r.current_stage] ?? r.current_stage.replace(/_/g, " ")) : null;
  const callback = cs?.callback_at ?? null;
  const loc = leadLocale(l, cfg);

  return (
    <div id={`lead-${r.lead_id}`} className={`rounded-lg border bg-white p-4 ${v.replyOpen ? "border-emerald-400" : v.callbackDue ? "border-red-300" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-sm text-navy">
            <a href={`/leads/${r.lead_id}`} className="hover:text-electric hover:underline">{l.full_name || `lead ${r.lead_id}`}</a>
            {l.role && <span className="ml-2 text-xs font-normal text-slate-500">{l.role}</span>}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">
            <span className="font-medium text-slate-700">{l.company || org?.name || "—"}</span>
            {org?.industry && <span> · {org.industry}</span>}
            {size !== null && <span> · {size} people</span>}
            {(org?.city || l.enrichment?.city) && <span> · {org?.city || l.enrichment?.city}</span>}
            {loc.country && <span> · {loc.country}</span>}
          </p>
          <p className="text-[11px] text-slate-400">their time {localTime(loc.tz)} · emails in {loc.language}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {tab === "today" && <Badge tone="slate">{STAGE_LABEL[stage]}</Badge>}
          {st === "replied"
            ? <Badge tone="electric">replied by {v.reply?.channel === "linkedin" ? "LinkedIn" : "email"}</Badge>
            : (cs?.calls ?? 0) > 0 && <Badge tone={OUTCOME_TONE[st] ?? "slate"}>last call: {OUTCOME_LABEL[st] ?? st}</Badge>}
          {(cs?.calls ?? 0) > 1 && <Badge tone="slate">{cs?.calls} calls</Badge>}
          {liStage && <Badge tone="electric">LinkedIn: {liStage}</Badge>}
          {cs?.email_consent && <Badge tone="slate">ok to email</Badge>}
          {callback && stage !== "closed" && <Badge tone={v.callbackDue ? "red" : "amber"}>call back {fmtWhen(callback, tz)}</Badge>}
          {stage === "meeting" && <Badge tone="green">{cs?.meeting_at ? `meeting ${fmtWhen(cs.meeting_at, tz)}` : "meeting, no date yet"}</Badge>}
        </div>
      </div>

      {v.replyOpen && v.reply && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <span>They replied by {v.reply.channel === "email" ? "email" : "LinkedIn"} {fmtWhen(v.reply.at, tz)}. Automatic messages are stopped, answer them yourself.</span>
          {canOperate && (
            <form action={`/api/calling/lead/${r.lead_id}?action=reply_handled`} method="post" className="ml-auto">
              <button className="rounded-md bg-emerald-600 px-2 py-1 font-medium text-white hover:opacity-90">Handled</button>
            </form>
          )}
        </div>
      )}

      {v.bounced && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Their email bounced {fmtWhen(l.email_bounced_at!, tz)}, so the emails stopped. Ask for the right address on the next call; saving a new one clears this.
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        {phone ? (
          <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className="rounded-md bg-electric px-3 py-1.5 font-medium text-white hover:opacity-90">☎ {phone}</a>
        ) : <span className="text-xs text-slate-400">☎ no phone</span>}
        {l.email ? <a href={`mailto:${l.email}`} className="text-xs text-electric hover:underline">✉ {l.email}</a> : <span className="text-xs text-slate-400">✉ no email</span>}
        {site && <a href={site} target="_blank" rel="noreferrer" className="text-xs text-electric hover:underline">website ↗</a>}
        {profile && <a href={profile} target="_blank" rel="noreferrer" className="text-xs text-electric hover:underline">LinkedIn ↗</a>}
      </div>

      {(cs?.notes || v.calls.length > 0 || v.seq || v.sent.length > 0) && (
        <div className="mt-2 space-y-1 rounded-md border-l-2 border-slate-200 bg-slate-50/60 px-3 py-2 text-xs leading-5 text-slate-600">
          {cs?.notes && <div><span className="text-slate-400">from your list: </span>{cs.notes}</div>}
          {v.calls.map((c, i) => (
            <div key={i}>
              <span className="text-slate-400">{fmtWhen(c.occurred_at, tz)} · {OUTCOME_LABEL[c.payload?.outcome ?? ""] ?? c.payload?.outcome}{c.payload?.by ? ` · ${c.payload.by.split("@")[0]}` : ""}: </span>
              {c.payload?.notes || <span className="text-slate-400">no notes</span>}
            </div>
          ))}
          {v.calls.length === 0 && cs?.last_notes && <div><span className="text-slate-400">last call: </span>{cs.last_notes}</div>}
          <EmailLine v={v} tz={tz} />
        </div>
      )}

      {canOperate && (
        <>
          {(cfg?.objections ?? []).length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-medium text-slate-500">Objections</summary>
              <dl className="mt-1 space-y-1">
                {cfg!.objections.map((o, i) => (
                  <div key={i}><dt className="font-medium text-slate-700">{o.objection}</dt><dd className="text-slate-600">{o.answer}</dd></div>
                ))}
              </dl>
            </details>
          )}
          <CallLogForm leadId={r.lead_id} email={l.email} emailConsent={!!cs?.email_consent}
            branches={cfg?.branches?.length ? cfg.branches.map(b => ({ key: b.key, label: b.label })) : undefined}
            hint={cfg?.call_hint || DEFAULT_CALL_HINT} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>move to:</span>
            {(["to_call", "follow_up", "meeting", "closed"] as const).filter(s => s !== stage).map(s => (
              <form key={s} action={`/api/calling/lead/${r.lead_id}?action=stage`} method="post">
                <input type="hidden" name="stage" value={s} />
                <button className="rounded border px-2 py-0.5 hover:bg-slate-50">{STAGE_LABEL[s]}</button>
              </form>
            ))}
            <details className="ml-auto">
              <summary className="cursor-pointer">country, time zone, language</summary>
              <form action={`/api/calling/lead/${r.lead_id}?action=locale`} method="post" className="mt-1 flex flex-wrap items-center gap-1">
                <input name="country" defaultValue={l.country ?? ""} placeholder={loc.country || "country"} className="w-28 rounded border px-1 py-0.5" />
                <input name="timezone" defaultValue={l.timezone ?? ""} placeholder={loc.tz} className="w-32 rounded border px-1 py-0.5" />
                <input name="language" defaultValue={l.language ?? ""} placeholder={loc.language} className="w-16 rounded border px-1 py-0.5" />
                <button className="rounded border px-2 py-0.5 hover:bg-slate-50">Save</button>
              </form>
            </details>
          </div>
        </>
      )}
    </div>
  );
}

function DraftCard({ d, canOperate }: { d: DraftRow; canOperate: boolean }) {
  const lead = leadOfDraft(d);
  const editable = d.status === "draft";
  return (
    <div id={`email-${d.id}`} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-sm text-navy">
            <a href={`/leads/${d.lead_id}`} className="hover:text-electric hover:underline">{lead?.full_name || `lead ${d.lead_id}`}</a>
            <span className="ml-2 text-xs font-normal text-slate-500">{lead?.company || ""}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">to {lead?.email || "—"} · email {d.step}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone={d.status === "draft" ? "amber" : d.status === "failed" ? "red" : "electric"}>{d.status}</Badge>
        </div>
      </div>
      {d.error && <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{NOTICE_COPY[`email:${d.error}`] ?? d.error}</div>}
      {canOperate && editable ? (
        <form action={`/api/calling/email/${d.id}?action=approve`} method="post" className="mt-3 space-y-2">
          <input name="subject" defaultValue={d.subject} className="w-full rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-700" />
          <textarea name="body" defaultValue={d.body} rows={9} className="w-full rounded-md border bg-slate-50 p-3 text-xs leading-5 text-slate-700" />
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <button className="rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90">Approve &amp; send</button>
            <button formAction={`/api/calling/email/${d.id}?action=save`} className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Save edits</button>
            <button formAction={`/api/calling/email/${d.id}?action=reject`} className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Reject</button>
            <span className="ml-auto text-[10px] text-slate-400">Edits travel with the approval. Sent from your own mailbox, signed by you.</span>
          </div>
        </form>
      ) : (
        <div className="mt-3">
          <div className="text-xs font-medium text-slate-700">{d.subject}</div>
          <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">{d.body}</pre>
          {canOperate && (
            <form action={`/api/calling/sequence/${d.sequence_id}`} method="post" className="mt-2">
              <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Stop sequence</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
