import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Clapperboard, Plus } from "lucide-react";
import { createPublicClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getTier } from "@/lib/tier";
import { getClientScope } from "@/lib/scope";
import { styleName, isHeld, type FinalReview } from "@/lib/videos";
import { fmtWhen } from "@/lib/calling";
import { TzCookie } from "@/components/tz-cookie";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  id: string;
  client_slug: string;
  status: string;
  final_review: FinalReview | null;
  brief: { goal?: string; style?: string } | null;
  duration_s: number;
  regen_of: string | null;
  consumed_credit: boolean;
  deliverable_version: number;
  created_at: string;
  updated_at: string;
};

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  draft: "slate",
  storyboard_pending: "amber",
  storyboard_ready: "electric",
  storyboard_approved: "electric",
  keyframes_generating: "amber",
  keyframes_ready: "electric",
  queued: "amber",
  rendering: "amber",
  delivered: "green",
  edit_requested: "amber",
  recomposing: "amber", redo_requested: "amber", redoing: "amber",
  approved: "green",
  published: "green",
  rejected: "slate",
  failed: "red",
  closed: "slate",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Upload not finished",
  storyboard_pending: "Writing storyboard",
  storyboard_ready: "Storyboard ready for you",
  storyboard_approved: "Approved, queueing",
  keyframes_generating: "Drawing the images",
  keyframes_ready: "Images ready for you",
  queued: "In production queue",
  rendering: "Producing",
  delivered: "Ready for your review",
  edit_requested: "Edit requested",
  recomposing: "Applying edits", redo_requested: "Redoing a scene", redoing: "Redoing a scene",
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
    .select("id, client_slug, status, brief, duration_s, regen_of, consumed_credit, deliverable_version, final_review, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (tier.isAdmin && scope) q = q.eq("client_slug", scope);
  const { data } = await q;
  const rows = (data ?? []) as Row[];
  const tz = decodeURIComponent((await cookies()).get("tz")?.value ?? "") || "Europe/London";
  // Closed requests are out of the way: folded at the foot of the list.
  const open = rows.filter(r => r.status !== "closed"), closed = rows.filter(r => r.status === "closed");
  const item = (r: Row) => (
    <li key={r.id} data-testid="video-row" data-status={r.status}>
      <Link href={`/videos/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
        <div className="flex min-w-0 items-center gap-3">
          <Clapperboard className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-800">
              {r.brief?.goal || "(no goal)"}
            </div>
            <div className="text-xs text-slate-500">
              {r.brief?.style === "auto" ? "" : `${r.duration_s}s · `}{styleName(r.brief?.style)}
              {r.regen_of ? " · regeneration" : ""}
              {r.deliverable_version > 1 ? ` · v${r.deliverable_version}` : ""}
              {tier.isAdmin && !scope ? ` · ${r.client_slug}` : ""}
            </div>
            <div className="text-[11px] text-slate-400" data-testid="video-row-when">
              Created {fmtWhen(r.created_at, tz)}
              {new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60000 ? ` · last change ${fmtWhen(r.updated_at, tz)}` : ""}
            </div>
          </div>
        </div>
        {isHeld(r)
          ? <Badge tone={tier.isAdmin ? "red" : "amber"}>{tier.isAdmin ? "Held: needs your look" : "Final check"}</Badge>
          : <Badge tone={STATUS_TONE[r.status] ?? "slate"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>}
      </Link>
    </li>
  );

  const weekStart = isoWeekStart(new Date());
  const usedThisWeek = rows.filter(r =>
    !r.regen_of && r.consumed_credit && isoWeekStart(new Date(r.created_at)) === weekStart,
  ).length;
  const quota = tier.features?.video_weekly_quota ?? 1;
  const maxS = tier.features?.video_max_duration_s ?? 15;
  // Step by step there is no weekly slot: a monthly budget, spent step by step with each price shown.
  const staged = !!tier.features?.video_staged_flow;
  const word = staged ? "script" : "storyboard";
  const canRequest = tier.isAdmin || staged || usedThisWeek < quota;

  return (
    <div className="space-y-6">
      <TzCookie />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">Videos</h1>
          <p className="text-sm text-slate-500">
            Short videos for your LinkedIn feed: brief it, approve the {word}, review the result.
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
          {staged ? (
            <>
              <span>Monthly production budget: <span className="font-medium text-navy">${Number(tier.features?.video_monthly_cap_usd ?? 0).toFixed(2)}</span></span>
              <span>Up to {maxS} seconds per video</span>
              <span>The script is free</span>
              <span>Every paid step shows its price first</span>
            </>
          ) : (
            <>
              <span>
                This week: <span className="font-medium text-navy">{usedThisWeek} of {quota}</span> video{quota === 1 ? "" : "s"} used
              </span>
              <span>Up to {maxS} seconds per video</span>
              <span>Free edits: unlimited</span>
              <span>Paid regeneration: 1 per video</span>
              {!canRequest && <Badge tone="amber">Next slot opens Monday</Badge>}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your video requests" hint={`${open.length} request${open.length === 1 ? "" : "s"}`} />
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              title="No videos yet"
              hint={`Start with a new video request: you approve a free ${word} before anything is produced.`}
            />
          ) : (
            <ul className="divide-y">
              {open.map(item)}
              {open.length === 0 && <li className="px-5 py-3 text-xs text-slate-500">No open requests.</li>}
              {closed.length > 0 && (
                <li>
                  <details data-testid="videos-closed">
                    <summary className="cursor-pointer px-5 py-3 text-xs text-slate-500 hover:bg-slate-50">Show closed ({closed.length})</summary>
                    <ul className="divide-y border-t">{closed.map(item)}</ul>
                  </details>
                </li>
              )}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
