import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { createPublicClient, serviceRoleClient } from "@/lib/supabase/server";
import { presignGet } from "@/lib/minio";
import { latestKeyframes, clientRedraws, needsKeyframes, styleName, MAX_KEYFRAME_REDRAWS, type Keyframe } from "@/lib/videos";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getTier } from "@/lib/tier";
import { VideoStatusPoller } from "@/components/video-status-poller";
import { SceneRedo } from "@/components/video-scene-redo";
import { SubmitDraft } from "@/components/video-submit-draft";
import { MAX_SCENE_REDOS } from "@/lib/video-dialogue";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Shot = { n?: number; kind?: string; description?: string; duration_s?: number; text_overlay?: string; asset?: string; recipe?: string | null; source_ref?: string | null; line?: { speaker?: string; text?: string } | null };
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
  cost_estimated_usd: number | null;
  deliverable_key: string | null;
  deliverable_version: number;
  error: string | null;
  created_at: string;
};

type Asset = { id: string; kind: string; storage_key: string; mime: string | null; size_bytes: number | null; meta?: { use?: string } | null };
type Ev = { id: number; event_type: string; actor: string; payload: Record<string, unknown> | null; created_at: string };

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  draft: "slate", storyboard_pending: "amber", storyboard_ready: "electric", storyboard_approved: "electric",
  keyframes_generating: "amber", keyframes_ready: "electric",
  queued: "amber", rendering: "amber", delivered: "green", edit_requested: "amber",
  recomposing: "amber", redo_requested: "amber", redoing: "amber", approved: "green", published: "green", rejected: "slate",
  failed: "red", closed: "slate",
};

export default async function VideoDetail({ params }: { params: Promise<{ id: string }> }) {
  const tier = await getTier();
  if (!tier.videoEnabled) redirect("/dashboard");

  const { id } = await params;
  const sb = await createPublicClient();
  const [{ data: reqData }, { data: assetData }, { data: evData }, { data: kfData }] = await Promise.all([
    sb.from("video_requests").select("*").eq("id", id).maybeSingle(),
    sb.from("video_assets").select("id, kind, storage_key, mime, size_bytes, meta").eq("request_id", id).order("created_at"),
    sb.from("video_events").select("id, event_type, actor, payload, created_at").eq("request_id", id).order("created_at", { ascending: false }).limit(30),
    sb.from("video_keyframes").select("id, shot_n, role, storage_key, status, version, notes, qc, model").eq("request_id", id),
  ]);
  const r = reqData as Req | null;
  if (!r) notFound();
  const assets = (assetData ?? []) as Asset[];
  const events = (evData ?? []) as Ev[];
  const refs = assets.filter(a => a.kind.startsWith("reference_") || a.kind === "logo");
  const act = `/api/videos/${r.id}`;
  // Parts that failed in the latest production run but did not stop delivery.
  // Events come newest first, so everything before the latest render_started is that run.
  const lastRun = events.findIndex(e => e.event_type === "render_started");
  const runEvents = lastRun === -1 ? events : events.slice(0, lastRun);
  const missing = Array.from(new Set(runEvents.flatMap(e =>
    e.event_type === "voiceover_failed" ? ["narration", "captions"]
    : e.event_type === "captions_stt_failed" ? ["word-timed captions"]
    : e.event_type === "music_failed" ? ["music"]
    : [])));
  const degraded = ["delivered", "approved", "published"].includes(r.status) && missing.length > 0;
  // Keyframe review: the stills every drawn shot starts (and maybe ends) on,
  // approved before any credit is consumed. The flag is per client; RLS above
  // already proved the caller may see this request.
  const { data: cfData } = await serviceRoleClient().schema("outreach").from("client_features")
    .select("video_keyframe_review").eq("client_slug", r.client_slug).maybeSingle();
  const keyframeReview = !!cfData?.video_keyframe_review && needsKeyframes(r.brief, r.storyboard as Record<string, unknown> | null);
  const kfRows = (kfData ?? []) as Keyframe[];
  const reviewing = ["keyframes_generating", "keyframes_ready"].includes(r.status);
  const kfLatest = reviewing ? latestKeyframes(kfRows) : [];
  const kfUrls = new Map<string, string>(await Promise.all(
    kfLatest.filter(k => k.storage_key).map(async k => [k.id, await presignGet(k.storage_key!, 3600)] as [string, string]),
  ));
  const kfToRedraw = kfLatest.filter(k => k.status === "rejected").length;
  const kfAllApproved = kfLatest.length > 0 && kfLatest.every(k => k.status === "approved");
  const imagesFailed = r.status === "failed" && !!r.error && /^(images could not be drawn|cannot draw the images)/.test(r.error);
  const isDialogue = r.brief?.style === "dialogue";
  const redosLeft = MAX_SCENE_REDOS - events.filter(e => e.event_type === "shot_redo_requested").length;
  const lastRedo = events.find(e => ["shot_redone", "shot_redo_failed"].includes(e.event_type));
  const brief = r.brief as { goal?: string; key_message?: string; cta?: string; style?: string; language?: string; voice?: boolean; visual_directions?: string;
    request?: string; style_by?: string; decision?: { summary?: string; remarks?: string[] } };
  // One-field form: the engine's agent chose the style (video-engine app/decide.py).
  const byAgent = brief.style_by === "agent";
  const choosing = brief.style === "auto";

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
            {choosing ? "" : `${r.duration_s}s · `}{styleName(brief.style)} · {brief.language}
            {brief.voice ? " · with voiceover" : ""}
            {r.regen_of ? " · regeneration" : ""}
          </p>
        </div>
        <Badge tone={STATUS_TONE[r.status] ?? "slate"}>{r.status.replace(/_/g, " ")}</Badge>
      </header>

      {r.status === "failed" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {imagesFailed
            ? "The images for this video could not be drawn. No credit was used."
            : "Production failed and your credit was returned."}{" "}
          {r.error ? `Detail: ${r.error}` : ""} You can approve the storyboard again to retry.
        </div>
      )}

      {r.error && (r.status === "draft" || r.status === "storyboard_ready") && (
        // The engine gave up after three tries (video-engine storyboard._failed).
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {r.status === "draft"
            ? "We could not write the storyboard for this request. Start it again below; if it happens again, write to us."
            : "We could not apply your last changes to the storyboard. Send them again; if it happens again, write to us."}
        </div>
      )}

      {degraded && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          This video was delivered without its {missing.join(" and ")} because of a fault on our side, not
          because of your brief. The fault is fixed; write to us and we produce it again.
        </div>
      )}

      {["queued", "rendering", "recomposing", "edit_requested", "redo_requested", "redoing"].includes(r.status) && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          {r.status === "queued" || r.status === "rendering"
            ? "In production: this usually takes 15-45 minutes. This page refreshes itself."
            : r.status === "redo_requested" || r.status === "redoing"
              ? "Redoing the scene: usually 5-15 minutes. The rest of the video is kept. This page refreshes itself."
              : "Applying your edit: usually just a few minutes. This page refreshes itself."}
        </div>
      )}

      {r.status === "delivered" && r.error && lastRedo?.event_type === "shot_redo_failed" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          The scene could not be redone; the video below is the previous version. Detail: {r.error}
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

      {/* Keyframe review: approve the images before production */}
      {reviewing && (
        <Card>
          <div id="keyframes" />
          <CardHeader
            title="Images"
            hint={r.status === "keyframes_generating"
              ? "being drawn, this page refreshes itself"
              : "approve each image; production starts only when you approve them all"}
          />
          <CardBody className="space-y-4">
            {r.status === "keyframes_generating" ? (
              <EmptyState
                title="Drawing the images"
                hint="Each generated shot is drawn as a still first, so you see how it will look before anything is produced. Usually 1-3 minutes. No credit is used yet."
              />
            ) : (
              <>
                <p className="text-xs text-slate-500">
                  Each shot of the video starts from this image (and ends on the second one where there are two).
                  Check that the person looks like the real one and that nothing is off. Asking for changes redraws
                  that image; it is free, up to {MAX_KEYFRAME_REDRAWS} times per image.
                </p>
                <ol className="space-y-4">
                  {Array.from(new Set(kfLatest.map(k => k.shot_n))).map(n => {
                    const shot = r.storyboard?.shots?.find(s => Number(s.n) === n);
                    return (
                      <li key={n} className="rounded-md border p-3">
                        <div className="mb-2 text-xs text-slate-700">
                          <span className="font-medium text-navy">Shot #{n}</span>
                          {shot?.duration_s ? ` · ${shot.duration_s}s` : ""}{shot?.description ? ` · ${shot.description}` : ""}
                          {shot?.line?.text && <div className="mt-0.5 text-slate-500">{shot.line.speaker || "Speaker"}: “{shot.line.text}”</div>}
                        </div>
                        <div className="flex flex-wrap gap-4">
                          {kfLatest.filter(k => k.shot_n === n).map(k => {
                            const redrawsLeft = MAX_KEYFRAME_REDRAWS - clientRedraws(kfRows, k.shot_n, k.role);
                            return (
                              <div key={k.id} className={`w-full space-y-2 ${k.model === "screen_preview" ? "max-w-[320px]" : "max-w-[220px]"}`}>
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span>{k.role === "start" ? "Start" : "End"} · v{k.version}</span>
                                  <Badge tone={k.status === "approved" ? "green" : k.status === "rejected" ? "amber" : "slate"}>
                                    {k.status === "approved" ? "approved" : k.status === "rejected" ? "to redraw" : "to review"}
                                  </Badge>
                                </div>
                                {kfUrls.get(k.id) ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <a href={kfUrls.get(k.id)} target="_blank" rel="noreferrer">
                                    <img src={kfUrls.get(k.id)} alt={`Shot ${n}, ${k.role} image`}
                                      className="w-full rounded-md border bg-slate-100 object-contain" />
                                  </a>
                                ) : (
                                  <div className="rounded-md border bg-slate-50 p-3 text-[11px] text-slate-400">Image not available</div>
                                )}
                                {k.model === "screen_preview" && (
                                  <p className="text-[11px] text-slate-500">
                                    Left: where your phone clip starts. Right: what its screen will show, with the person in the app saying the line.
                                  </p>
                                )}
                                {k.qc?.hint && k.status !== "rejected" && (
                                  <div className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">Worth a look: {k.qc.hint}</div>
                                )}
                                {k.status === "rejected" && k.notes && (
                                  <div className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">Change asked: {k.notes}</div>
                                )}
                                {k.status === "proposed" && (
                                  <form action={`${act}/keyframes/${k.id}`} method="post">
                                    <input type="hidden" name="action" value="approve" />
                                    <button className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                                      Approve image
                                    </button>
                                  </form>
                                )}
                                {k.status !== "rejected" && k.model !== "screen_preview" && (
                                  redrawsLeft > 0 ? (
                                    <details>
                                      <summary className="cursor-pointer text-[11px] font-medium text-slate-600 hover:text-slate-800">
                                        Ask for changes ({redrawsLeft} left)
                                      </summary>
                                      <form action={`${act}/keyframes/${k.id}`} method="post" className="mt-1">
                                        <input type="hidden" name="action" value="reject" />
                                        <textarea name="notes" rows={2} required maxLength={500}
                                          placeholder="e.g. She looks older than in real life; warmer light"
                                          className="w-full rounded-md border bg-white p-2 text-[11px] leading-4" />
                                        <button className="mt-1 rounded-md bg-amber-500 px-3 py-1 text-[11px] font-medium text-white hover:opacity-90">
                                          Mark for redraw
                                        </button>
                                        {k.role === "start" && kfLatest.some(o => o.shot_n === n && o.role === "end") && (
                                          <p className="mt-1 text-[11px] text-slate-400">The end image is redrawn too, so both match.</p>
                                        )}
                                      </form>
                                    </details>
                                  ) : (
                                    <p className="text-[11px] text-slate-400">No redraws left for this image.</p>
                                  )
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                <div className="space-y-3 border-t pt-4">
                  {kfToRedraw > 0 && (
                    <form action={`${act}/keyframes/redraw`} method="post">
                      <button className="rounded-md bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:opacity-90">
                        Redraw {kfToRedraw} marked image{kfToRedraw === 1 ? "" : "s"}
                      </button>
                      <p className="mt-1 text-[11px] text-slate-400">Free. Approved images are kept.</p>
                    </form>
                  )}
                  <form action={`${act}/produce`} method="post">
                    <button disabled={!kfAllApproved}
                      className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                      Approve images and start production
                    </button>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {kfAllApproved
                        ? `This uses your video slot for the week${r.regen_of ? " (paid regeneration)" : ""}. Production takes 15-45 minutes.`
                        : "Available once every image is approved."}
                    </p>
                  </form>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {r.status === "draft" && (
        <Card>
          <CardHeader title="Not started yet" />
          <CardBody><SubmitDraft videoId={r.id} /></CardBody>
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
            <EmptyState title="Storyboard in progress"
              hint={choosing
                ? "We are choosing the kind of video and writing the script: usually about 2 minutes. This page refreshes itself."
                : "The draft usually takes about 2 minutes. This page refreshes itself."} />
          ) : (
            <>
              {byAgent && !choosing && (
                <div className="rounded-md border border-electric/30 bg-electric/5 p-3 text-xs leading-5 text-slate-700">
                  <div className="font-medium text-navy">
                    {brief.decision?.summary || `A ${r.duration_s}-second video: ${styleName(brief.style)}.`}
                  </div>
                  {r.cost_estimated_usd != null && (
                    <div className="mt-0.5 text-slate-500">Estimated production cost: ${Number(r.cost_estimated_usd).toFixed(2)}</div>
                  )}
                  {(brief.decision?.remarks ?? []).map((m, i) => (
                    <div key={i} className="mt-1 text-amber-800">{m}</div>
                  ))}
                  {r.status === "storyboard_ready" && (
                    <div className="mt-1 text-slate-500">Not what you had in mind? Ask for changes below, including a different kind of video.</div>
                  )}
                </div>
              )}
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
                        {isDialogue && s.kind ? ` · ${({ ceo: "to camera", persona: "invented person", pantalla: "your app on the phone" } as Record<string, string>)[s.kind] ?? s.kind}` : ""}
                        {s.duration_s ? ` · ${s.duration_s}s` : ""} · {s.description ?? ""}
                        {s.line?.text && (
                          <div className="mt-1 text-slate-700">
                            <span className="font-medium">{s.line.speaker || "Speaker"} says:</span> “{s.line.text}”
                          </div>
                        )}
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
                  {keyframeReview ? "Approve storyboard and draw the images" : "Approve storyboard and start production"}
                </button>
                <p className="mt-1 text-[11px] text-slate-400">
                  {(isDialogue || byAgent) && r.cost_estimated_usd ? `Estimated production cost: $${Number(r.cost_estimated_usd).toFixed(2)}. ` : ""}
                  {keyframeReview
                    ? "Next you see and approve an image of every shot. Nothing is produced and no credit is used until you approve the images."
                    : <>This uses your video slot for the week{r.regen_of ? " (paid regeneration)" : ""}. Free edits stay unlimited after delivery.</>}
                </p>
              </form>
              <details>
                <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-800">Request changes (free)</summary>
                <form action={`${act}/storyboard`} method="post" className="mt-2 max-w-lg">
                  <textarea name="notes" rows={3} required
                    placeholder={byAgent ? "e.g. Let the customer say it in their own words; or: make it scenes with a narrator instead" : "What should change in the script or shots?"}
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

            {isDialogue && (
              <details>
                <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-800">
                  Redo one scene (new image, movement or voice)
                </summary>
                <div className="mt-2">
                  <SceneRedo videoId={r.id} redosLeft={redosLeft}
                    scenes={(r.storyboard?.shots ?? []).map((s, i) => ({
                      n: Number(s.n ?? i + 1), kind: s.kind ?? "persona",
                      speaker: s.line?.speaker ?? "", text: s.line?.text ?? "" }))} />
                </div>
              </details>
            )}

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
            {brief.request && <div className="whitespace-pre-wrap"><span className="font-medium">Your request:</span> {brief.request}</div>}
            {!brief.request && <div><span className="font-medium">Goal:</span> {brief.goal}</div>}
            {brief.key_message && <div><span className="font-medium">Key message:</span> {brief.key_message}</div>}
            {brief.cta && <div><span className="font-medium">CTA:</span> {brief.cta}</div>}
            {brief.visual_directions && <div><span className="font-medium">Visual directions:</span> {brief.visual_directions}</div>}
            {refs.length > 0 && (
              <div className="pt-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">References</div>
                <ul className="space-y-1">
                  {refs.map(a => (
                    <li key={a.id} className="text-slate-600">
                      {a.kind === "reference_video" ? "🎞" : a.kind === "reference_audio" ? "🎙" : "🖼"} {a.storage_key.split("/").pop()}
                      {a.size_bytes ? ` · ${(a.size_bytes / 1024 / 1024).toFixed(1)}MB` : ""}
                      {" · "}{({ as_is: "shown as it is", example: "example only", footage: "footage", look: "look reference",
                        screen_clip: "phone clip", screen: "app screen", line: `recording of line ${(a.meta as { line?: number } | null)?.line ?? ""}` } as Record<string, string>)[
                        a.meta?.use ?? (a.kind === "reference_video" ? "footage" : "look")] ?? ""}
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
