import { serviceRoleClient } from "@/lib/supabase/server";
import { presignGet } from "@/lib/minio";
import { isHeld, type FinalReview } from "@/lib/videos";
import { boardOf, type Job, type Montage, type Take } from "@/lib/video-staged";
import type { StagedData } from "@/components/video-staged";

export type Row = {
  id: string; client_slug: string; status: string; brief: Record<string, unknown>; storyboard: unknown; montage?: Montage | null;
  deliverable_key: string | null; deliverable_version: number; error: string | null; final_review: FinalReview | null;
};
type Kf = { id: string; shot_n: number; role: "start" | "end"; version: number; status: string; storage_key: string | null; notes: string | null; model: string | null };

/** Everything the step-by-step page shows for one request, links signed. The
 * caller already proved (RLS) that this user may see the request. The page
 * renders it on the server and the client polls GET /api/videos/:id/staged for
 * the same shape while a job runs, updating only what changed. */
export async function loadStaged(r: Row, isAdmin: boolean): Promise<StagedData> {
  const svc = serviceRoleClient();
  const [kf, tk, jb, cr, sp, up] = await Promise.all([
    svc.from("video_keyframes").select("id, shot_n, role, version, status, storage_key, notes, model").eq("request_id", r.id).order("version", { ascending: false }),
    svc.from("video_shot_takes").select("*").eq("request_id", r.id).order("version", { ascending: false }),
    svc.from("video_jobs").select("id, kind, shot_n, role, status, cost_estimate_usd, cost_actual_usd, error, created_at, result")
      .eq("request_id", r.id).order("created_at", { ascending: false }).limit(40),
    isAdmin ? svc.from("video_change_requests").select("id, shot_n, target, note, region, status, actor, created_at")
      .eq("request_id", r.id).order("created_at", { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
    svc.rpc("video_month_spend", { p_client: r.client_slug }),
    svc.from("video_assets").select("storage_key, kind, meta").eq("request_id", r.id).in("kind", ["reference_video", "reference_image"]),
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
      hands: t.lips?.hands && t.lips.hands.ok === false
        ? { what: t.lips.hands.what ?? "a ring", at_s: Number(t.lips.hands.at_s ?? 0), url: t.lips.hands.key ? await sign(t.lips.hands.key) : null } : null,
      checks: isAdmin ? await Promise.all((t.lips?.check ?? []).slice(0, 3).map(sign)) : [],
    };
  }));
  // The client's own clips, by file name: a shot made from one shows its stretch.
  const used = new Set((boardOf(r)?.shots ?? []).filter(s => s.kind === "clip").map(s => s.source_ref));
  const uploads = (up.data ?? []) as { storage_key: string; kind: string; meta: { use?: string } | null }[];
  // The client's own pictures a drawn shot may show (mirror of video-engine plan.card_pictures).
  const pictures = uploads.filter(a => a.kind === "reference_image" && a.meta?.use !== "person" && /\.(jpe?g|png|webp)$/i.test(a.storage_key))
    .map(a => a.storage_key.split("/").pop()!);
  const clips = Object.fromEntries(await Promise.all(uploads.filter(a => a.kind === "reference_video")
    .map(a => [a.storage_key.split("/").pop()!, a.storage_key] as const).filter(([name]) => used.has(name))
    .map(async ([name, key]) => [name, await sign(key)] as const)));
  // The sketch of each shot, until its real picture or take exists.
  const sketches = Object.fromEntries(await Promise.all((boardOf(r)?.shots ?? []).filter(s => s.sketch?.key)
    .map(async s => [String(s.n), { url: await sign(s.sketch!.key), says: s.sketch!.says }] as const)));
  // Who presents a video with animated scenes, and the photo they are drawn from.
  const pr = boardOf(r)?.launch?.presenter;
  let presenter: StagedData["presenter"];
  if (pr) {
    const from = pr.from === "photo" || pr.from === "character" ? pr.from : "page";
    let key: string | null = from === "page" ? pr.key ?? null
      : from === "photo" ? uploads.find(a => a.kind === "reference_image" && a.storage_key.split("/").pop() === pr.file)?.storage_key ?? null : null;
    if (from === "character" && pr.name) {
      const { data: ch } = await svc.from("video_characters").select("sheet_key").eq("client_slug", r.client_slug)
        .eq("status", "approved").eq("name", pr.name).order("version", { ascending: false }).limit(1);
      key = (ch?.[0] as { sheet_key?: string | null } | undefined)?.sheet_key ?? null;
    }
    presenter = { from, name: pr.name ?? null, url: key ? await sign(key) : null };
  }
  const held = isHeld(r);
  const versions = r.deliverable_key && !(held && !isAdmin)
    ? await Promise.all(Array.from({ length: r.deliverable_version }, (_, i) => r.deliverable_version - i)
      .map(async v => ({ version: v, url: await sign(`deliverables/${r.id}/v${v}.mp4`) })))
    : [];
  const spend = sp.data as { cap_usd: number; spent_usd: number; pending_usd: number } | null;
  const data: StagedData = {
    lang: String((r.brief as { language?: string } | null)?.language ?? "").toLowerCase() || undefined,
    id: r.id, status: r.status, isAdmin, error: r.error, held,
    page: String((r.brief as { product_url?: string } | null)?.product_url ?? "") || undefined,
    board: boardOf(r), montage: (r.montage ?? {}) as Montage,
    spend: spend ? { cap_usd: Number(spend.cap_usd), spent_usd: Number(spend.spent_usd), pending_usd: Number(spend.pending_usd) } : null,
    images, takes, clips, pictures, sketches, presenter, jobs: (jb.data ?? []) as Job[], versions,
    changes: (cr.data ?? []) as StagedData["changes"],
  };
  return data;
}
