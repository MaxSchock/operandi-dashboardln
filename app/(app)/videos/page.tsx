import Link from "next/link";
import { redirect } from "next/navigation";
import { Clapperboard, Plus } from "lucide-react";
import { createPublicClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getTier } from "@/lib/tier";
import { getClientScope } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  id: string;
  client_slug: string;
  status: string;
  brief: { goal?: string; style?: string } | null;
  duration_s: number;
  regen_of: string | null;
  consumed_credit: boolean;
  deliverable_version: number;
  created_at: string;
  updated_at: string;
};

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  storyboard_pending: "amber",
  storyboard_ready: "electric",
  storyboard_approved: "electric",
  queued: "amber",
  rendering: "amber",
  delivered: "green",
  edit_requested: "amber",
  recomposing: "amber",
  approved: "green",
  published: "green",
  rejected: "slate",
  failed: "red",
  closed: "slate",
};

const STATUS_LABEL: Record<string, string> = {
  storyboard_pending: "Writing storyboard",
  storyboard_ready: "Storyboard ready for you",
  storyboard_approved: "Approved, queueing",
  queued: "In production queue",
  rendering: "Producing",
  delivered: "Ready for your review",
  edit_requested: "Edit requested",
  recomposing: "Applying edits",
  approved: "Approved by you",
  published: "Published",
  rejected: "Rejected",
  failed: "Production failed",
  closed: "Closed",
};

function isoWeekStart(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

export default async function VideosPage() {
  const tier = await getTier();
  if (!tier.videoEnabled) redirect("/dashboard");
  const scope = await getClientScope();

  const sb = await createPublicClient();
  let q = sb.from("video_requests")
    .select("id, client_slug, status, brief, duration_s, regen_of, consumed_credit, deliverable_version, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (tier.isAdmin && scope) q = q.eq("client_slug", scope);
  const { data } = await q;
  const rows = (data ?? []) as Row[];

  const weekStart = isoWeekStart(new Date());
  const usedThisWeek = rows.filter(r =>
    !r.regen_of && r.consumed_credit && isoWeekStart(new Date(r.created_at)) === weekStart,
  ).length;
  const quota = tier.features?.video_weekly_quota ?? 1;
  const maxS = tier.features?.video_max_duration_s ?? 15;
  const canRequest = tier.isAdmin || usedThisWeek < quota;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">Videos</h1>
          <p className="text-sm text-slate-500">
            Short videos for your LinkedIn feed: brief it, approve the storyboard, review the result.
          </p>
        </div>
        <Link
          href="/videos/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-electric px-3 py-2 text-xs font-medium text-white hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> New video request
        </Link>
      </header>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
          <span>
            This week: <span className="font-medium text-navy">{usedThisWeek} of {quota}</span> video{quota === 1 ? "" : "s"} used
          </span>
          <span>Up to {maxS} seconds per video</span>
          <span>Free edits: unlimited</span>
          <span>Paid regeneration: 1 per video</span>
          {!canRequest && <Badge tone="amber">Next slot opens Monday</Badge>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your video requests" hint={`${rows.length} request${rows.length === 1 ? "" : "s"}`} />
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              title="No videos yet"
              hint="Start with a new video request: you approve a free storyboard before anything is produced."
            />
          ) : (
            <ul className="divide-y">
              {rows.map(r => (
                <li key={r.id}>
                  <Link href={`/videos/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="flex min-w-0 items-center gap-3">
                      <Clapperboard className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">
                          {r.brief?.goal || "(no goal)"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {r.duration_s}s · {r.brief?.style ?? "?"}
                          {r.regen_of ? " · regeneration" : ""}
                          {r.deliverable_version > 1 ? ` · v${r.deliverable_version}` : ""}
                          {tier.isAdmin && !scope ? ` · ${r.client_slug}` : ""}
                        </div>
                      </div>
                    </div>
                    <Badge tone={STATUS_TONE[r.status] ?? "slate"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
