import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { createPublicClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getTier } from "@/lib/tier";
import { VideoStatusPoller } from "@/components/video-status-poller";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Shot = { n?: number; description?: string; duration_s?: number; text_overlay?: string; asset?: string };
type Storyboard = {
  script?: string;
  shots?: Shot[];
  voiceover?: string | null;
  music?: string | null;
  notes?: string | null;
};

type Req = {
  id: string;
  client_slug: string;
  status: string;
  brief: Record<string, unknown>;
  duration_s: number;
  recipe: string | null;
  storyboard: Storyboard | null;
  storyboard_notes: string | null;
  regen_of: string | null;
  consumed_credit: boolean;
  deliverable_key: string | null;
  deliverable_version: number;
  error: string | null;
  created_at: string;
};

type Asset = { id: string; kind: string; storage_key: string; mime: string | null; size_bytes: number | null };
type Ev = { id: number; event_type: string; actor: string; payload: Record<string, unknown> | null; created_at: string };

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  storyboard_pending: "amber", storyboard_ready: "electric", storyboard_approved: "electric",
  queued: "amber", rendering: "amber", delivered: "green", edit_requested: "amber",
  recomposing: "amber", approved: "green", published: "green", rejected: "slate",
  failed: "red", closed: "slate",
};

export default async function VideoDetail({ params }: { params: Promise<{ id: string }> }) {
  const tier = await getTier();
  if (!tier.videoEnabled) redirect("/dashboard");

  const { id } = await params;
  const sb = await createPublicClient();
  const [{ data: reqData }, { data: assetData }, { data: evData }] = await Promise.all([
    sb.from("video_requests").select("*").eq("id", id).maybeSingle(),
    sb.from("video_assets").select("id, kind, storage_key, mime, size_bytes").eq("request_id", id).order("created_at"),
    sb.from("video_events").select("id, event_type, actor, payload, created_at").eq("request_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  const r = reqData as Req | null;
  if (!r) notFound();
  const assets = (assetData ?? []) as Asset[];
  const events = (evData ?? []) as Ev[];
  const refs = assets.filter(a => a.kind.startsWith("reference_"));
  const act = `/api/videos/${r.id}`;
  const brief = r.brief as { goal?: string; key_message?: string; cta?: string; style?: string; language?: string; voice?: boolean; visual_directions?: string };

  return (
    <div className="space-y-6">
      <VideoStatusPoller status={r.status} />
      <div>
        <Link href="/videos" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3 w-3" /> Back to videos
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">{brief.goal ?? "Video request"}</h1>
          <p className="text-sm text-slate-500">
            {r.duration_s}s · {brief.style} · {brief.language}
            {brief.voice ? " · with voiceover" : ""}
            {r.regen_of ? " · regeneration" : ""}
          </p>
        </div>
        <Badge tone={STATUS_TONE[r.status] ?? "slate"}>{r.status.replace(/_/g, " ")}</Badge>
      </header>

      {r.status === "failed" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          Production failed and your credit was returned. {r.error ? `Detail: ${r.error}` : ""} You can approve the storyboard again to retry.
        </div>
      )}

      {["queued", "rendering", "recomposing", "edit_requested"].includes(r.status) && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          {r.status === "queued" || r.status === "rendering"
            ? "In production: this usually takes 15-45 minutes. This page refreshes itself."
            : "Applying your edit: usually just a few minutes. This page refreshes itself."}
        </div>
      )}

      {/* Deliverable player */}
      {r.deliverable_key && (
        <Card>
          <CardHeader
            title={`Video · v${r.deliverable_version}`}
            action={
              <a href={`${act}/deliverable`} className="inline-flex items-center gap-1 text-xs text-electric hover:underline">
                <Download className="h-3 w-3" /> Download
              </a>
            }
          />
          <CardBody>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video controls preload="metadata" className="max-h-[480px] w-full rounded-md border bg-black" src={`${act}/deliverable`} />
          </CardBody>
        </Card>
      )}

      {/* Storyboard */}
      <Card>
        <CardHeader
          title="Storyboard"
          hint={
            r.status === "storyboard_pending"
              ? "being written, this page refreshes itself"
              : r.status === "storyboard_ready"
                ? "review and approve to start production"
                : undefined
          }
        />
        <CardBody className="space-y-4">
          {!r.storyboard ? (
            <EmptyState title="Storyboard in progress" hint="The draft usually takes about 2 minutes. This page refreshes itself." />
          ) : (
            <>
              {r.storyboard.script && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Script</div>
                  <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">{r.storyboard.script}</pre>
                </div>
              )}
              {(r.storyboard.shots?.length ?? 0) > 0 && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Shots</div>
                  <ol className="space-y-2">
                    {r.storyboard.shots!.map((s, i) => (
                      <li key={i} className="rounded-md border p-3 text-xs text-slate-700">
                        <span className="font-medium text-navy">#{s.n ?? i + 1}</span>
                        {s.duration_s ? ` · ${s.duration_s}s` : ""} · {s.description ?? ""}
                        {s.text_overlay && <div className="mt-1 text-slate-500">Overlay: “{s.text_overlay}”</div>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {r.storyboard.voiceover && (
                <div className="text-xs text-slate-600"><span className="font-medium">Voiceover:</span> {r.storyboard.voiceover}</div>
              )}
              {r.storyboard.music && (
                <div className="text-xs text-slate-600"><span className="font-medium">Music:</span> {r.storyboard.music}</div>
              )}
            </>
          )}

          {(r.status === "storyboard_ready" || (r.status === "failed" && r.storyboard)) && (
            <div className="space-y-3 border-t pt-4">
              <form action={`${act}/approve-storyboard`} method="post">
                <button className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:opacity-90">
                  Approve storyboard and start production
                </button>
                <p className="mt-1 text-[11px] text-slate-400">
                  This uses your video slot for the week{r.regen_of ? " (paid regeneration)" : ""}. Free edits stay unlimited after delivery.
                </p>
              </form>
              <details>
                <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-800">Request changes (free)</summary>
                <form action={`${act}/storyboard`} method="post" className="mt-2 max-w-lg">
                  <textarea name="notes" rows={3} required placeholder="What should change in the script or shots?"
                    className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
                  <button className="mt-1 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                    Send change request
                  </button>
                </form>
              </details>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Delivered actions */}
      {r.status === "delivered" && (
        <Card>
          <CardHeader title="What next?" />
          <CardBody className="space-y-4">
            <form action={`${act}/approve`} method="post">
              <button className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:opacity-90">
                Approve this video
              </button>
              <p className="mt-1 text-[11px] text-slate-400">Approval is required before anything is published.</p>
            </form>

            <details>
              <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-800">
                Request changes (free edit: text, music, subtitles, clip order)
              </summary>
              <form action={`${act}/edit`} method="post" className="mt-2 max-w-lg">
                <textarea name="notes" rows={3} required placeholder="e.g. Bigger captions, calmer music, swap shot 2 and 3"
                  className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
                <button className="mt-1 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                  Request free edit
                </button>
                <p className="mt-1 text-[11px] text-slate-400">Free and unlimited. Does not use your regeneration.</p>
              </form>
            </details>

            {!r.regen_of && (
              <details>
                <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-800">
                  Regenerate video (new footage, uses your 1 paid regeneration)
                </summary>
                <form action={`${act}/regen`} method="post" className="mt-2 max-w-lg">
                  <textarea name="notes" rows={3} required placeholder="What should be different in the new version?"
                    className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
                  <button className="mt-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                    Start regeneration
                  </button>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Creates new footage from an updated storyboard you approve first. Available once per video.
                  </p>
                </form>
              </details>
            )}
          </CardBody>
        </Card>
      )}

      {/* Brief + references */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Brief" />
          <CardBody className="space-y-2 text-xs text-slate-700">
            <div><span className="font-medium">Goal:</span> {brief.goal}</div>
            <div><span className="font-medium">Key message:</span> {brief.key_message}</div>
            <div><span className="font-medium">CTA:</span> {brief.cta}</div>
            {brief.visual_directions && <div><span className="font-medium">Visual directions:</span> {brief.visual_directions}</div>}
            {refs.length > 0 && (
              <div className="pt-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">References</div>
                <ul className="space-y-1">
                  {refs.map(a => (
                    <li key={a.id} className="text-slate-600">
                      {a.kind === "reference_video" ? "🎞" : "🖼"} {a.storage_key.split("/").pop()}
                      {a.size_bytes ? ` · ${(a.size_bytes / 1024 / 1024).toFixed(1)}MB` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="History" />
          <CardBody className="p-0">
            {events.length === 0 ? (
              <EmptyState title="No events yet" />
            ) : (
              <ul className="divide-y">
                {events.map(e => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs">
                    <span className="text-slate-700">{e.event_type.replace(/_/g, " ")} <span className="text-slate-400">· {e.actor}</span></span>
                    <span className="text-slate-400">{new Date(e.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
