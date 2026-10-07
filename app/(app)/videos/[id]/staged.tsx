import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui";
import { loadStaged, type Row } from "@/lib/video-staged-load";
import { VideoStaged } from "@/components/video-staged";
import { SubmitDraft } from "@/components/video-submit-draft";

const STAGE: Record<string, string> = {
  draft: "draft", script_pending: "writing the shots", script_ready: "script", script_approved: "pictures",
  images_approved: "filming", shots_ready: "montage", assembling: "assembling", delivered: "delivered", failed: "failed",
};

/** Step-by-step video: the caller already proved through RLS that this user
 * may see the request; everything else is read with the service role. */
export async function StagedVideo({ r, isAdmin }: { r: Row; isAdmin: boolean }) {
  const data = await loadStaged(r, isAdmin);
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
