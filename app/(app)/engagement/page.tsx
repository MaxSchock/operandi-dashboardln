import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";
import { LockedPanel } from "@/components/locked-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Lead = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  headline: string | null;
  company: string | null;
};

type ProposalRow = {
  id: number;
  client_slug: string;
  lead_id: number;
  post_social_id: string;
  pain_id: string | null;
  pain_label: string | null;
  engagement_type: string;
  proposed_text: string;
  connection_degree: string | null;
  status: "pending" | "approved" | "rejected" | "sent" | "failed";
  created_at: string;
  lead: Lead | null;
};

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  pending: "amber",
  approved: "electric",
  sent: "green",
  rejected: "slate",
  failed: "red",
};

const ENGAGEMENT_LABEL: Record<string, string> = {
  reaction: "Reacted",
  comment: "Commented",
  repost: "Reposted",
};

export default async function EngagementPage() {
  const tier = await getTier();
  if (!tier.hasOutreach) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl text-navy">Warm DMs</h1>
        </header>
        <LockedPanel feature="engagement" />
      </div>
    );
  }

  const sb = await createClient();
  const scope = await getClientScope();
  const { data: { user } } = await sb.auth.getUser();

  let q = sb
    .from("dm_proposals")
    .select("*, lead:leads(full_name,email,phone,headline,company)")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(200);
  if (scope) q = q.eq("client_slug", scope);

  const userInfoPromise = user
    ? sb.from("client_users").select("role").eq("user_id", user.id).maybeSingle()
    : Promise.resolve({ data: null });
  const [{ data }, { data: userInfo }] = await Promise.all([q, userInfoPromise]);
  const rows = (data ?? []) as ProposalRow[];
  const isAdmin = userInfo?.role === "operandi_admin";

  const pending = rows.filter(r => r.status === "pending");
  const history = rows.filter(r => r.status !== "pending");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Warm DMs</h1>
        <p className="text-sm text-slate-500">
          A contact from the ICP base engaged with a post. Review the themed DM and approve to send.
          {" "}Not connected yet → a blank invitation goes first, the DM follows once they accept.
        </p>
      </header>

      <Card>
        <CardHeader title="Pending approval" hint={`${pending.length} proposal${pending.length === 1 ? "" : "s"} waiting`} />
        <CardBody className="space-y-4">
          {pending.length === 0 ? (
            <EmptyState title="Nothing to review" hint="New engagement proposals will appear here." />
          ) : (
            pending.map(p => <ProposalCard key={p.id} p={p} isAdmin={isAdmin} editable />)
          )}
        </CardBody>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader title="History" hint={`${history.length} processed`} />
          <CardBody className="space-y-4">
            {history.map(p => <ProposalCard key={p.id} p={p} isAdmin={isAdmin} editable={false} />)}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ProposalCard({ p, isAdmin, editable }: { p: ProposalRow; isAdmin: boolean; editable: boolean }) {
  const lead = p.lead;
  const name = lead?.full_name || `lead ${p.lead_id}`;
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-sm text-navy">{name}</div>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            {lead?.headline || lead?.company || "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone="slate">{ENGAGEMENT_LABEL[p.engagement_type] ?? p.engagement_type}</Badge>
          {p.pain_label && <Badge tone="electric">{p.pain_label.slice(0, 40)}</Badge>}
          <Badge tone={STATUS_TONE[p.status] ?? "slate"}>{p.status}</Badge>
          {p.connection_degree && p.connection_degree !== "unknown" && (
            <Badge tone="slate">{p.connection_degree === "DISTANCE_1" ? "1st degree" : "not connected"}</Badge>
          )}
        </div>
      </div>

      {/* Contact channels — mailto / tel links */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {lead?.email ? (
          <a href={`mailto:${lead.email}`} className="text-electric hover:underline">✉ {lead.email}</a>
        ) : (
          <span className="text-slate-400">✉ no email</span>
        )}
        {lead?.phone ? (
          <a href={`tel:${lead.phone}`} className="text-electric hover:underline">☎ {lead.phone}</a>
        ) : (
          <span className="text-slate-400">☎ no phone</span>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400">
          {new Date(p.created_at).toLocaleDateString()}
        </span>
      </div>

      {editable && isAdmin ? (
        <form action={`/api/admin/dm-proposal/${p.id}?action=save`} method="post" className="mt-3">
          <textarea
            name="proposed_text"
            defaultValue={p.proposed_text}
            rows={4}
            className="w-full rounded-md border bg-slate-50 p-3 text-xs leading-5 text-slate-700"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
              Save text
            </button>
          </div>
        </form>
      ) : (
        <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">{p.proposed_text}</pre>
      )}

      {editable && isAdmin && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-3">
          <form action={`/api/admin/dm-proposal/${p.id}?action=approve`} method="post">
            <button className="rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90">
              Approve &amp; send
            </button>
          </form>
          <form action={`/api/admin/dm-proposal/${p.id}?action=reject`} method="post">
            <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
              Reject
            </button>
          </form>
          <span className="ml-auto text-[10px] text-slate-400">Save text first, then approve.</span>
        </div>
      )}
    </div>
  );
}
