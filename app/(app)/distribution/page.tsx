import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GroupRow = {
  client_slug: string;
  group_row_id: number;
  group_id: string;
  name: string | null;
  url: string | null;
  members_estimate: number | null;
  language: string | null;
  relevance_score: number | null;
  relevance_reason: string | null;
  status: "discovered" | "candidate" | "approved" | "member" | "rejected";
  discovery_source: "web" | "voyager" | "account_membership" | "manual";
  first_seen_at: string;
};

type QueueRow = {
  client_slug: string;
  queue_row_id: number;
  group_id: string;
  group_name: string | null;
  group_url: string | null;
  variant_text: string | null;
  similarity_score: number | null;
  status: "proposed" | "approved" | "sent" | "rejected" | "failed";
  source_text: string | null;
  source_url: string | null;
  created_at: string;
};

const GROUP_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  discovered: "amber", candidate: "amber", approved: "green", member: "green", rejected: "slate",
};
const QUEUE_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  proposed: "amber", approved: "electric", sent: "green", rejected: "slate", failed: "red",
};
const SOURCE_LABEL: Record<string, string> = {
  web: "web", voyager: "voyager", account_membership: "member", manual: "manual",
};

export default async function DistributionPage({ searchParams }: { searchParams?: { actionError?: string } }) {
  const tier = await getTier();
  const canSee = tier.isAdmin || (tier.features?.has_content ?? false);
  if (!canSee) {
    return (
      <div className="space-y-6">
        <header><h1 className="font-display text-2xl text-navy">Distribution</h1></header>
        <EmptyState title="Not available on your plan" hint="Group distribution is part of the content product." />
      </div>
    );
  }

  const actionError = (searchParams?.actionError ?? "").slice(0, 220);
  const sb = await createClient();
  const scope = await getClientScope();

  let gq = sb.from("content_groups").select("*").order("relevance_score", { ascending: false, nullsFirst: false }).limit(500);
  let qq = sb.from("content_group_queue").select("*").order("created_at", { ascending: false }).limit(300);
  if (scope) { gq = gq.eq("client_slug", scope); qq = qq.eq("client_slug", scope); }
  const [{ data: gData }, { data: qData }] = await Promise.all([gq, qq]);
  const groups = (gData ?? []) as GroupRow[];
  const queue = (qData ?? []) as QueueRow[];

  const pending = queue.filter(q => q.status === "proposed" || q.status === "approved");
  const queueHistory = queue.filter(q => q.status === "sent" || q.status === "rejected" || q.status === "failed");

  const byClient = new Map<string, GroupRow[]>();
  for (const r of groups) {
    const list = byClient.get(r.client_slug) ?? [];
    list.push(r);
    byClient.set(r.client_slug, list);
  }
  const clients = [...byClient.keys()].sort();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Distribution</h1>
        <p className="text-sm text-slate-500">
          LinkedIn groups discovered per client and the per-group variants queued for approval.
          Approve a variant, publish it in the group, then mark it sent. Nothing is posted automatically.
        </p>
      </header>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span className="font-medium">That didn&apos;t work: </span>{actionError}
        </div>
      )}

      <Card>
        <CardHeader title="Approval queue" hint={`${pending.length} variant${pending.length === 1 ? "" : "s"} waiting`} />
        <CardBody className="space-y-4">
          {pending.length === 0 ? (
            <EmptyState title="Nothing to approve" hint="Variants appear here once groups are approved and posts are published." />
          ) : (
            pending.map(q => <QueueCard key={q.queue_row_id} q={q} />)
          )}
        </CardBody>
      </Card>

      {clients.map(slug => {
        const list = byClient.get(slug)!;
        return (
          <Card key={slug}>
            <CardHeader title={slug} hint={`${list.length} group${list.length === 1 ? "" : "s"}`} />
            <CardBody className="space-y-2">
              {list.map(g => <GroupRowItem key={g.group_row_id} g={g} />)}
            </CardBody>
          </Card>
        );
      })}

      {queueHistory.length > 0 && (
        <Card>
          <CardHeader title="Queue history" hint={`${queueHistory.length} processed`} />
          <CardBody className="space-y-2">
            {queueHistory.map(q => (
              <div key={q.queue_row_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs">
                <span className="text-slate-600">{q.group_name || `group ${q.group_id}`}</span>
                <Badge tone={QUEUE_TONE[q.status] ?? "slate"}>{q.status}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function GroupRowItem({ g }: { g: GroupRow }) {
  const canApprove = g.status === "discovered" || g.status === "candidate" || g.status === "rejected";
  const canReject = g.status !== "rejected";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        {g.url ? (
          <a href={g.url} target="_blank" rel="noopener noreferrer" className="font-display text-sm text-navy hover:text-electric hover:underline">
            {g.name || `group ${g.group_id}`}
          </a>
        ) : (
          <span className="font-display text-sm text-navy">{g.name || `group ${g.group_id}`}</span>
        )}
        {g.relevance_reason && <p className="mt-0.5 text-xs leading-5 text-slate-500">{g.relevance_reason}</p>}
        <div className="mt-2 flex items-center gap-2">
          {canApprove && (
            <form action={`/api/admin/group/${g.group_row_id}?action=approve`} method="post">
              <button className="rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90">Approve</button>
            </form>
          )}
          {canReject && (
            <form action={`/api/admin/group/${g.group_row_id}?action=reject`} method="post">
              <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Discard</button>
            </form>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {g.relevance_score != null && (
          <Badge tone={g.relevance_score >= 75 ? "green" : g.relevance_score >= 50 ? "electric" : "slate"}>{g.relevance_score}%</Badge>
        )}
        {g.members_estimate != null && <Badge tone="slate">{g.members_estimate.toLocaleString()} members</Badge>}
        {g.language && <Badge tone="slate">{g.language}</Badge>}
        <Badge tone="slate">{SOURCE_LABEL[g.discovery_source] ?? g.discovery_source}</Badge>
        <Badge tone={GROUP_TONE[g.status] ?? "slate"}>{g.status}</Badge>
      </div>
    </div>
  );
}

function QueueCard({ q }: { q: QueueRow }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {q.group_url ? (
            <a href={q.group_url} target="_blank" rel="noopener noreferrer" className="font-display text-sm text-navy hover:text-electric hover:underline">
              {q.group_name || `group ${q.group_id}`}
            </a>
          ) : (
            <span className="font-display text-sm text-navy">{q.group_name || `group ${q.group_id}`}</span>
          )}
          {q.source_url && (
            <a href={q.source_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-[11px] text-slate-400 hover:underline">source post ↗</a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {q.similarity_score != null && <Badge tone="slate">sim {q.similarity_score}</Badge>}
          <Badge tone={QUEUE_TONE[q.status] ?? "slate"}>{q.status}</Badge>
        </div>
      </div>

      <form action={`/api/admin/group-post/${q.queue_row_id}?action=edit`} method="post" className="mt-3">
        <textarea name="variant_text" defaultValue={q.variant_text ?? ""} rows={6}
          className="w-full rounded-md border bg-slate-50 p-3 text-xs leading-5 text-slate-700" />
        <div className="mt-2">
          <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Save text</button>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-3">
        {q.status === "proposed" && (
          <form action={`/api/admin/group-post/${q.queue_row_id}?action=approve`} method="post">
            <button className="rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90">Approve</button>
          </form>
        )}
        {q.status === "approved" && (
          <form action={`/api/admin/group-post/${q.queue_row_id}?action=mark-sent`} method="post">
            <button className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:opacity-90">Mark sent</button>
          </form>
        )}
        <form action={`/api/admin/group-post/${q.queue_row_id}?action=reject`} method="post">
          <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Reject</button>
        </form>
        {q.status === "approved" && (
          <span className="ml-auto text-[10px] text-slate-400">Publish it in the group, then mark sent.</span>
        )}
      </div>
    </div>
  );
}
