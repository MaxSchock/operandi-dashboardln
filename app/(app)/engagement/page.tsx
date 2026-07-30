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
  unipile_provider_id: string | null;
  enrichment: { profile_url?: string | null } | null;
};

type ProposalRow = {
  id: number;
  client_slug: string;
  lead_id: number;
  post_social_id: string;
  pain_id: string | null;
  pain_label: string | null;
  engagement_type: string;
  post_excerpt: string | null;
  post_published_at: string | null;
  proposed_text: string;
  connection_degree: string | null;
  error: string | null;
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

/** Why a send did not go out. These come from the strategist, which reads the real
 *  LinkedIn thread before sending, so they describe reality and not a bug. */
const REASON_COPY: Record<string, string> = {
  already_messaged: "Not sent: this account has already written to them. Open the conversation on LinkedIn and continue it by hand.",
  inbound_unanswered: "Not sent: they wrote first and the message is still unanswered. Open the conversation and reply personally.",
  provider_unreachable: "Not sent: LinkedIn could not be reached. Nothing was sent, try again later.",
  already_connected: "Already a connection, no invitation needed. You can approve the message.",
  invite_already_pending: "An invitation to this person is already pending.",
  empty_proposed_text: "The message is empty. Write it and save before approving.",
  no_provider_id: "This contact has no usable LinkedIn id yet.",
  no_unipile_account: "No LinkedIn account is configured for this client.",
};

function reasonCopy(reason: string | null): string | null {
  if (!reason) return null;
  const key = reason.split(":")[0].trim();
  return REASON_COPY[key] ?? `Not sent: ${reason}`;
}

/** LinkedIn renders the numeric activity id as a feed permalink. */
function postUrl(socialId: string): string {
  return `https://www.linkedin.com/feed/update/urn:li:activity:${socialId}/`;
}

/** Reactions only give us the opaque ACoAA member urn, comments give a real vanity
 *  slug. Both resolve to a profile, so link either and never print the raw urn. */
function profileUrl(lead: Lead | null): string | null {
  const fromEnrichment = lead?.enrichment?.profile_url;
  if (fromEnrichment) return fromEnrichment;
  if (lead?.unipile_provider_id) return `https://www.linkedin.com/in/${lead.unipile_provider_id}`;
  return null;
}

function degreeLabel(degree: string | null): { text: string; tone: "green" | "slate" } | null {
  if (!degree) return null;
  if (degree === "DISTANCE_1") return { text: "1st degree", tone: "green" };
  if (degree === "unknown") return null;
  return { text: "Not connected", tone: "slate" };
}

export default async function EngagementPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const tier = await getTier();
  if (!tier.hasEngagement) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl text-navy">Warm DMs</h1>
        </header>
        <LockedPanel feature="engagement" />
      </div>
    );
  }

  const params = await searchParams;
  const notice = params.notice ? reasonCopy(params.notice) : null;

  const sb = await createClient();
  const scope = await getClientScope();

  let q = sb
    .from("dm_proposals")
    .select("*, lead:leads(full_name,email,phone,headline,company,unipile_provider_id,enrichment)")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(200);
  if (scope) q = q.eq("client_slug", scope);

  const { data } = await q;
  const rows = (data ?? []) as ProposalRow[];

  const pending = rows.filter(r => r.status === "pending" || r.status === "failed");
  const history = rows.filter(r => r.status !== "pending" && r.status !== "failed");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Warm DMs</h1>
        <p className="text-sm text-slate-500">
          Someone from the target profile engaged with a post. Review the person and the post,
          then approve the message to send it.
          {" "}Not connected yet → a blank invitation goes first, the message follows once they accept.
        </p>
      </header>

      {notice && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {notice}
        </div>
      )}

      <Card>
        <CardHeader title="Pending approval" hint={`${pending.length} proposal${pending.length === 1 ? "" : "s"} waiting`} />
        <CardBody className="space-y-4">
          {pending.length === 0 ? (
            <EmptyState title="Nothing to review" hint="New engagement proposals will appear here." />
          ) : (
            pending.map(p => <ProposalCard key={p.id} p={p} canOperate={tier.canOperate} editable />)
          )}
        </CardBody>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader title="History" hint={`${history.length} processed`} />
          <CardBody className="space-y-4">
            {history.map(p => <ProposalCard key={p.id} p={p} canOperate={tier.canOperate} editable={false} />)}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ProposalCard({ p, canOperate, editable }: { p: ProposalRow; canOperate: boolean; editable: boolean }) {
  const lead = p.lead;
  const name = lead?.full_name || `lead ${p.lead_id}`;
  const profile = profileUrl(lead);
  const degree = degreeLabel(p.connection_degree);
  const connected = p.connection_degree === "DISTANCE_1";
  const blocked = reasonCopy(p.error);
  const engaged = ENGAGEMENT_LABEL[p.engagement_type] ?? p.engagement_type;
  const postDate = p.post_published_at
    ? new Date(p.post_published_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-sm text-navy">
            {profile ? (
              <a href={profile} target="_blank" rel="noreferrer" className="hover:text-electric hover:underline">
                {name} ↗
              </a>
            ) : name}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            {lead?.headline || lead?.company || "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone="slate">{engaged}</Badge>
          <Badge tone={STATUS_TONE[p.status] ?? "slate"}>{p.status}</Badge>
          {degree && <Badge tone={degree.tone}>{degree.text}</Badge>}
        </div>
      </div>

      {/* Which post this is about. Without it, people who engaged with different posts
          looked like one group under a single theme label. */}
      <div className="mt-3 rounded-md border-l-2 border-slate-200 bg-slate-50/60 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] uppercase tracking-wide text-slate-400">
          <span>{engaged} on your post</span>
          {postDate && <span className="normal-case tracking-normal text-slate-500">{postDate}</span>}
          <a
            href={postUrl(p.post_social_id)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto normal-case tracking-normal text-electric hover:underline"
          >
            View post ↗
          </a>
        </div>
        {p.post_excerpt && (
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-600">{p.post_excerpt}</p>
        )}
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

      {blocked && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          {blocked}
        </div>
      )}

      {editable && canOperate ? (
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

      {editable && canOperate && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-3">
          <form action={`/api/admin/dm-proposal/${p.id}?action=approve`} method="post">
            <button className="rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90">
              Approve &amp; send
            </button>
          </form>
          {!connected && (
            <form action={`/api/admin/dm-proposal/${p.id}?action=connect`} method="post">
              <button className="rounded-md border border-electric px-3 py-1 text-xs font-medium text-electric hover:bg-electric/5">
                Send connection request
              </button>
            </form>
          )}
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
