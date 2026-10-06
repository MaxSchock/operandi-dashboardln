import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { serviceRoleClient } from "@/lib/supabase/server";
import { presignGet } from "@/lib/minio";
import { Badge } from "@/components/ui";
import { isHeld, type FinalReview } from "@/lib/videos";
import { boardOf, type Job, type Montage, type Take } from "@/lib/video-staged";
import { VideoStaged, type StagedData } from "@/components/video-staged";
import { SubmitDraft } from "@/components/video-submit-draft";

type Row = {
  id: string; client_slug: string; status: string; brief: Record<string, unknown>; storyboard: unknown; montage?: Montage | null;
  deliverable_key: string | null; deliverable_version: number; error: string | null; final_review: FinalReview | null;
};
type Kf = { id: string; shot_n: number; role: "start" | "end"; version: number; status: string; storage_key: string | null; notes: string | null; model: string | null };

const STAGE: Record<string, string> = {
  draft: "draft", script_pending: "writing the shots", script_ready: "script", script_approved: "pictures",
  images_approved: "filming", shots_ready: "montage", assembling: "assembling", delivered: "delivered", failed: "failed",
};

/** Step-by-step video: the caller already proved through RLS that this user
 * may see the request; everything else is read with the service role. */
export async function StagedVideo({ r, isAdmin }: { r: Row; isAdmin: boolean }) {
  const svc = serviceRoleClient();
  const [kf, tk, jb, cr, sp, up] = await Promise.all([
    svc.from("video_keyframes").select("id, shot_n, role, version, status, storage_key, notes, model").eq("request_id", r.id).order("version", { ascending: false }),
    svc.from("video_shot_takes").select("*").eq("request_id", r.id).order("version", { ascending: false }),
    svc.from("video_jobs").select("id, kind, shot_n, role, status, cost_estimate_usd, cost_actual_usd, error, created_at, result")
      .eq("request_id", r.id).order("created_at", { ascending: false }).limit(40),
    isAdmin ? svc.from("video_change_requests").select("id, shot_n, target, note, region, status, actor, created_at")
      .eq("request_id", r.id).order("created_at", { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
    svc.rpc("video_month_spend", { p_client: r.client_slug }),
    svc.from("video_assets").select("storage_key").eq("request_id", r.id).eq("kind", "reference_video"),
  ]);
  const sign = (key: string) => presignGet(key, 3600);
  const images = await Promise.all(((kf.data ?? []) as Kf[]).filter(k => k.storage_key && k.status !== "failed").map(async k => ({
    id: k.id, n: k.shot_n, role: k.role, version: k.version, status: k.status, notes: k.notes,
    carried: k.model === "continuity", url: await sign(k.storage_key!),
  })));
  const rows = ((tk.data ?? []) as Take[]).filter(t => t.status !== "failed" && t.storage_key);
  const newest = new Set<string>();
  const takes = await Promise.all(rows.map(async t => {
    // Frames to mark a change on: only for the take the person is looking at first.
    const first = !newest.has(String(t.shot_n)) && t.status !== "stale";
    if (first) newest.add(String(t.shot_n));
    const count = first && t.frames_prefix ? Math.max(1, Math.floor(Number(t.duration_s) * 2)) : 0;
    return {
      id: t.id, n: t.shot_n, version: t.version, status: t.status, notes: t.notes, duration_s: Number(t.duration_s),
      voice_end_s: t.voice_end_s === null ? null : Number(t.voice_end_s), first_last: String(t.model ?? "").includes("first-last"),
      lips: t.lips ? { where: t.lips.where ?? null, done: t.lips.done !== false, reason: t.lips.reason ?? null,
        dub: t.lips.dub ?? null, dub_failed: t.lips.dub_failed ?? null } : null,
      url: await sign(t.storage_key),
      frames: await Promise.all(Array.from({ length: count }, (_, i) => sign(`${t.frames_prefix}/f-${String(i + 1).padStart(3, "0")}.jpg`))),
      checks: isAdmin ? await Promise.all((t.lips?.check ?? []).slice(0, 3).map(sign)) : [],
    };
  }));
  // The client's own clips, by file name: a shot made from one shows its stretch.
  const used = new Set((boardOf(r)?.shots ?? []).filter(s => s.kind === "clip").map(s => s.source_ref));
  const clips = Object.fromEntries(await Promise.all(((up.data ?? []) as { storage_key: string }[])
    .map(a => [a.storage_key.split("/").pop()!, a.storage_key] as const).filter(([name]) => used.has(name))
    .map(async ([name, key]) => [name, await sign(key)] as const)));
  const held = isHeld(r);
  const versions = r.deliverable_key && !(held && !isAdmin)
    ? await Promise.all(Array.from({ length: r.deliverable_version }, (_, i) => r.deliverable_version - i)
      .map(async v => ({ version: v, url: await sign(`deliverables/${r.id}/v${v}.mp4`) })))
    : [];
  const spend = sp.data as { cap_usd: number; spent_usd: number; pending_usd: number } | null;
  const data: StagedData = {
    lang: String((r.brief as { language?: string } | null)?.language ?? "").toLowerCase() || undefined,
    id: r.id, status: r.status, isAdmin, error: r.error, held,
    board: boardOf(r), montage: (r.montage ?? {}) as Montage,
    spend: spend ? { cap_usd: Number(spend.cap_usd), spent_usd: Number(spend.spent_usd), pending_usd: Number(spend.pending_usd) } : null,
    images, takes, clips, jobs: (jb.data ?? []) as Job[], versions,
    changes: (cr.data ?? []) as StagedData["changes"],
  };
  const brief = r.brief as { goal?: string; request?: string; language?: string };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/videos" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3 w-3" /> Back to videos
        </Link>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">{brief.goal ?? "Video request"}</h1>
          <p className="text-sm text-slate-500">Step by step · {brief.language}</p>
        </div>
        <Badge tone={r.status === "delivered" ? "green" : r.status === "failed" ? "red" : "electric"}>{STAGE[r.status] ?? r.status}</Badge>
      </header>
      {brief.request && (
        <details className="rounded-2xl border bg-white px-5 py-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium">What you asked for</summary>
          <p className="mt-2 whitespace-pre-wrap leading-5">{brief.request}</p>
        </details>
      )}
      {r.status === "draft" && !data.jobs.some(j => j.kind === "script_propose") && <SubmitDraft videoId={r.id} />}
      <VideoStaged data={data} />
    </div>
  );
}
