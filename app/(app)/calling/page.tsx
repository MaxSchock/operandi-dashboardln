import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";
import { LockedPanel } from "@/components/locked-panel";
import {
  NURTURE_BRANCHES, OUTCOME_LABEL, OUTCOME_TONE, orgPhone, orgSize, sizeBucket, websiteHref,
  type CallingState, type Enrichment,
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
  enrichment: Enrichment;
};

type Row = {
  lead_id: number;
  client_slug: string;
  current_stage: string;
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

function leadOf(r: Row): LeadInfo | null {
  if (!r.leads) return null;
  return Array.isArray(r.leads) ? (r.leads[0] ?? null) : r.leads;
}
function leadOfDraft(d: DraftRow) {
  if (!d.lead) return null;
  return Array.isArray(d.lead) ? (d.lead[0] ?? null) : d.lead;
}

const STATUS_FILTERS = ["queued", "no_answer", "orange", "green", "red", "replied", "all"] as const;
const SIZE_FILTERS = ["5-20", "21-50", "51+", "unknown", "all"] as const;

const NOTICE_COPY: Record<string, string> = {
  "nurture:drafted": "Call saved. Email 1 is drafted below, read it and approve to send.",
  "nurture:no_email": "Call saved, but this lead has no email address, so no nurturing sequence was opened.",
  "nurture:sequence_exists": "Call saved. A nurturing sequence is already open for this lead.",
  "nurture:draft_failed": "Call saved, but the email draft could not be written. Try again from the card.",
  "email:sent": "Email sent from your mailbox.",
  "email:queued": "Approved. It goes out in the next sending window (Mon to Thu, 9:00 to 17:00 UK).",
  "email:rejected": "Draft rejected, sequence stopped.",
  "email:stopped": "Sequence stopped.",
  "email:no_email_account": "Your mailbox is not connected yet, nothing was sent. Ask Max for the connection link.",
  "email:inbound_unanswered": "Not sent: they already wrote to you. Reply by hand, the sequence is stopped.",
  "email:already_messaged": "Not sent: you already emailed this person by hand. Continue that thread yourself.",
  "email:provider_unreachable": "Not sent: the mailbox could not be reached. Nothing went out, try again later.",
  "email:daily_quota_reached": "Not sent: today's email cap is reached. It will go out tomorrow.",
};
function noticeCopy(raw: string | undefined): string | null {
  if (!raw) return null;
  return NOTICE_COPY[raw] ?? raw.replace(/^[a-z]+:/, "").replace(/_/g, " ");
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
  const status = (STATUS_FILTERS as readonly string[]).includes(params.status ?? "") ? params.status : "queued";
  const size = (SIZE_FILTERS as readonly string[]).includes(params.size ?? "") ? params.size : "5-20";
  const q = (params.q ?? "").trim().toLowerCase();
  const scope = await getClientScope();
  const client = params.client ?? scope ?? (tier.isAdmin ? "all" : (tier.clientSlug ?? "all"));
  const notice = noticeCopy(params.notice);

  const sb = await createClient();
  const select = "lead_id, client_slug, current_stage, updated_at, channel_state, leads!inner(id, full_name, headline, company, email, phone, role, source_batch, enrichment)";
  let qCalling = sb.from("lead_state").select(select).not("channel_state->calling", "is", null)
    .order("updated_at", { ascending: false }).limit(800);
  // Leads that were sourced for LinkedIn but fit the calling profile (phone + 5-20 people)
  // are shown too, so nothing already paid for goes to waste. Logging a call on one of
  // them creates its calling state.
  let qLegacy = sb.from("lead_state").select(select).is("channel_state->calling", null)
    .in("current_stage", ["pre_contact", "paused"]).order("updated_at", { ascending: false }).limit(800);
  if (client !== "all") { qCalling = qCalling.eq("client_slug", client); qLegacy = qLegacy.eq("client_slug", client); }
  let qDrafts = sb.from("email_messages")
    .select("id, sequence_id, lead_id, client_slug, step, subject, body, status, error, created_at, lead:leads(full_name, email, company)")
    .in("status", ["draft", "approved", "failed"]).order("created_at", { ascending: false }).limit(50);
  if (client !== "all") qDrafts = qDrafts.eq("client_slug", client);

  const [{ data: callingRows }, { data: legacyRows }, { data: draftRows }] = await Promise.all([qCalling, qLegacy, qDrafts]);
  const legacy = ((legacyRows ?? []) as unknown as Row[]).filter(r => {
    const l = leadOf(r);
    return l && orgPhone(l) && sizeBucket(orgSize(l)) === "5-20";
  });
  const all = [...((callingRows ?? []) as unknown as Row[]), ...legacy];

  const rows = all.filter(r => {
    const l = leadOf(r);
    if (!l) return false;
    const cs = r.channel_state?.calling;
    const st = cs?.status ?? "queued";
    if (status !== "all" && st !== status) return false;
    if (size !== "all" && sizeBucket(orgSize(l)) !== size) return false;
    if (q) {
      const hay = `${l.full_name ?? ""} ${l.company ?? ""} ${l.enrichment?.organization?.industry ?? ""} ${l.enrichment?.organization?.city ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Callbacks due first, then never-called, then most recently touched.
  rows.sort((a, b) => {
    const ca = a.channel_state?.calling?.callback_at ?? "";
    const cb = b.channel_state?.calling?.callback_at ?? "";
    if (ca && !cb) return -1;
    if (cb && !ca) return 1;
    if (ca && cb) return ca.localeCompare(cb);
    return (a.channel_state?.calling?.calls ?? 0) - (b.channel_state?.calling?.calls ?? 0);
  });

  const drafts = ((draftRows ?? []) as unknown as DraftRow[]);
  const counts = all.reduce<Record<string, number>>((acc, r) => {
    const st = r.channel_state?.calling?.status ?? "queued";
    acc[st] = (acc[st] ?? 0) + 1; return acc;
  }, {});
  const todayKey = new Date().toISOString().slice(0, 10);
  const calledToday = all.filter(r => (r.channel_state?.calling?.last_call_at ?? "").startsWith(todayKey)).length;
  const clientsSeen = Array.from(new Set(all.map(r => r.client_slug))).sort();
  const uploadClient = client !== "all" ? client : (clientsSeen[0] ?? "zayd");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">Calling</h1>
          <p className="text-sm text-slate-500">
            Phone first, nothing automated before the call. Log the outcome on each card:
            red stops everything, orange opens the email follow-ups from your mailbox, green means a meeting.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="slate">{counts.queued ?? 0} to call</Badge>
          <Badge tone="electric">{calledToday} called today</Badge>
          <Badge tone="amber">{counts.orange ?? 0} orange</Badge>
          <Badge tone="green">{counts.green ?? 0} green</Badge>
        </div>
      </header>

      {notice && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{notice}</div>
      )}

      {drafts.length > 0 && (
        <Card>
          <CardHeader title="Emails waiting for you" hint={`${drafts.length} draft${drafts.length === 1 ? "" : "s"} · email 1 of each sequence needs your approval, the following ones go out on their own`} />
          <CardBody className="space-y-4">
            {drafts.map(d => <DraftCard key={d.id} d={d} canOperate={tier.canOperate} />)}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Filters" hint="Callbacks due come first, then people never called." />
        <CardBody>
          <form method="get" className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_10rem_9rem_9rem_5rem]">
            <input name="q" defaultValue={params.q ?? ""} placeholder="Name, company, trade, city"
              className="rounded-md border px-3 py-2 text-sm" />
            <select name="status" defaultValue={status} className="rounded-md border px-3 py-2 text-sm">
              {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : (OUTCOME_LABEL[s] ?? s)}</option>)}
            </select>
            <select name="size" defaultValue={size} className="rounded-md border px-3 py-2 text-sm">
              {SIZE_FILTERS.map(s => <option key={s} value={s}>{s === "all" ? "Any size" : `${s} people`}</option>)}
            </select>
            {tier.isAdmin ? (
              <select name="client" defaultValue={client} className="rounded-md border px-3 py-2 text-sm">
                <option value="all">All clients</option>
                {clientsSeen.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : <input type="hidden" name="client" value={client} />}
            <button className="rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:opacity-90">Go</button>
          </form>
          {tier.canOperate && (
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

      <Card>
        <CardHeader title="Leads" hint={`${rows.length} shown`} />
        <CardBody className="space-y-3">
          {rows.length === 0 ? (
            <EmptyState title="Nobody to call with these filters" hint="Change the status or size filter, upload a list, or top up from Apollo." />
          ) : rows.map(r => <LeadCard key={r.lead_id} r={r} canOperate={tier.canOperate} />)}
        </CardBody>
      </Card>
    </div>
  );
}

function LeadCard({ r, canOperate }: { r: Row; canOperate: boolean }) {
  const l = leadOf(r)!;
  const cs = r.channel_state?.calling;
  const st = cs?.status ?? "queued";
  const org = l.enrichment?.organization ?? null;
  const phone = orgPhone(l);
  const size = orgSize(l);
  const site = websiteHref(org?.website_url);
  const profile = l.enrichment?.profile_url || l.enrichment?.linkedin_url || null;
  const inLinkedInQueue = r.current_stage !== "paused";
  const callback = cs?.callback_at ? new Date(cs.callback_at) : null;
  const callbackDue = callback ? callback.getTime() <= Date.now() : false;
  const nurture = cs?.nurture ?? null;

  return (
    <div id={`lead-${r.lead_id}`} className="rounded-lg border p-4">
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
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone={OUTCOME_TONE[st] ?? "slate"}>{OUTCOME_LABEL[st] ?? st}</Badge>
          {(cs?.calls ?? 0) > 0 && <Badge tone="slate">{cs?.calls} call{cs?.calls === 1 ? "" : "s"}</Badge>}
          {inLinkedInQueue && <Badge tone="electric">LinkedIn queue</Badge>}
          {nurture?.status && <Badge tone={nurture.status === "replied" ? "green" : "amber"}>email {nurture.status}{nurture.step ? ` · ${nurture.step}` : ""}</Badge>}
          {callback && <Badge tone={callbackDue ? "red" : "amber"}>call back {callback.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Badge>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        {phone ? (
          <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className="rounded-md bg-electric px-3 py-1.5 font-medium text-white hover:opacity-90">☎ {phone}</a>
        ) : <span className="text-xs text-slate-400">☎ no phone</span>}
        {l.email ? <a href={`mailto:${l.email}`} className="text-xs text-electric hover:underline">✉ {l.email}</a> : <span className="text-xs text-slate-400">✉ no email</span>}
        {site && <a href={site} target="_blank" rel="noreferrer" className="text-xs text-electric hover:underline">website ↗</a>}
        {profile && <a href={profile} target="_blank" rel="noreferrer" className="text-xs text-electric hover:underline">LinkedIn ↗</a>}
      </div>

      {(cs?.last_notes || cs?.notes) && (
        <div className="mt-2 rounded-md border-l-2 border-slate-200 bg-slate-50/60 px-3 py-2 text-xs leading-5 text-slate-600">
          {cs?.notes && <div><span className="text-slate-400">from your list: </span>{cs.notes}</div>}
          {cs?.last_notes && <div><span className="text-slate-400">last call: </span>{cs.last_notes}</div>}
        </div>
      )}

      {canOperate && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-electric">Log this call</summary>
          <form action={`/api/calling/outcome/${r.lead_id}`} method="post" className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-2 text-xs">
              {(["no_answer", "red", "orange", "green"] as const).map(o => (
                <label key={o} className="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1">
                  <input type="radio" name="outcome" value={o} required defaultChecked={o === "no_answer"} />
                  <span>{OUTCOME_LABEL[o]}</span>
                </label>
              ))}
            </div>
            <textarea name="notes" rows={3} placeholder="What they said: can they take more work? what is the bottleneck? who decides?"
              className="w-full rounded-md border bg-slate-50 p-2 text-xs leading-5 text-slate-700" />
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">call back <input type="datetime-local" name="callback_at" className="rounded-md border px-2 py-1 text-xs" /></label>
              <label className="flex items-center gap-1"><input type="checkbox" name="linkedin_connect" /> connect on LinkedIn</label>
              <label className="flex items-center gap-1">if orange, they are:
                <select name="branch" className="rounded-md border px-2 py-1 text-xs" defaultValue="generic">
                  {NURTURE_BRANCHES.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
              </label>
              <button className="ml-auto rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90">Save call</button>
            </div>
          </form>
        </details>
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
