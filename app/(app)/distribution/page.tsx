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

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  discovered: "amber",
  candidate: "amber",
  approved: "green",
  member: "green",
  rejected: "slate",
};

const SOURCE_LABEL: Record<string, string> = {
  web: "web",
  voyager: "voyager",
  account_membership: "member",
  manual: "manual",
};

export default async function DistributionPage() {
  const tier = await getTier();
  const canSee = tier.isAdmin || (tier.features?.has_content ?? false);
  if (!canSee) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl text-navy">Distribution</h1>
        </header>
        <EmptyState
          title="Not available on your plan"
          hint="Group distribution is part of the content product."
        />
      </div>
    );
  }

  const sb = await createClient();
  const scope = await getClientScope();

  let q = sb
    .from("content_groups")
    .select("*")
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(500);
  if (scope) q = q.eq("client_slug", scope);
  const { data } = await q;
  const rows = (data ?? []) as GroupRow[];

  // Group rows by outreach client_slug so an admin viewing "all" sees one card per client.
  const byClient = new Map<string, GroupRow[]>();
  for (const r of rows) {
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
          LinkedIn groups discovered for each client, scored against their audience. This is a
          candidate list: open each group to verify it fits before it is used. Nothing is posted
          from here.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No groups yet"
              hint="The weekly scout populates this list once group distribution is enabled for a client."
            />
          </CardBody>
        </Card>
      ) : (
        clients.map(slug => {
          const list = byClient.get(slug)!;
          return (
            <Card key={slug}>
              <CardHeader title={slug} hint={`${list.length} group${list.length === 1 ? "" : "s"}`} />
              <CardBody className="space-y-2">
                {list.map(g => (
                  <GroupRowItem key={g.group_row_id} g={g} />
                ))}
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}

function GroupRowItem({ g }: { g: GroupRow }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {g.url ? (
            <a
              href={g.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display text-sm text-navy hover:text-electric hover:underline"
            >
              {g.name || `group ${g.group_id}`}
            </a>
          ) : (
            <span className="font-display text-sm text-navy">{g.name || `group ${g.group_id}`}</span>
          )}
        </div>
        {g.relevance_reason && (
          <p className="mt-0.5 text-xs leading-5 text-slate-500">{g.relevance_reason}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {g.relevance_score != null && (
          <Badge tone={g.relevance_score >= 75 ? "green" : g.relevance_score >= 50 ? "electric" : "slate"}>
            {g.relevance_score}%
          </Badge>
        )}
        {g.members_estimate != null && (
          <Badge tone="slate">{g.members_estimate.toLocaleString()} members</Badge>
        )}
        {g.language && <Badge tone="slate">{g.language}</Badge>}
        <Badge tone="slate">{SOURCE_LABEL[g.discovery_source] ?? g.discovery_source}</Badge>
        <Badge tone={STATUS_TONE[g.status] ?? "slate"}>{g.status}</Badge>
      </div>
    </div>
  );
}
