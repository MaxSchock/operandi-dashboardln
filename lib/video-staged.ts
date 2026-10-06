import type { SupabaseClient } from "@supabase/supabase-js";
import type { VideoActor, VideoRequest } from "@/lib/videos";

/**
 * Staged flow (video-engine app/plan.py, stage.py, montage.py): the panel
 * directs a video shot by shot. The panel never calls the engine: it edits the
 * shot table and the montage settings, and queues jobs through
 * video_job_enqueue(), which checks the stage, the monthly budget and the
 * weekly slot in one transaction. Prices live in the engine (storyboard.costs).
 */

export type StagedShot = {
  n: number;
  kind: "persona" | "pantalla" | "silent" | "ceo" | "clip";
  text: string;
  speaker: string;
  text_by?: "client" | "agent" | "clip";
  audio: "line" | "narration" | "none";
  narration?: string | null;
  camera?: string;
  link: "cut" | "continuity";
  lips?: { who?: string; where?: "face" | "phone"; region?: Region | null } | null;
  scene?: string | null;
  recipe?: string | null;
  duration_s: number;
  to_phone?: boolean;
  /** kind "clip": a stretch of the client's own clip, shown as it is (recipe "cut") or with
   * its person replaced (recipe "swap") by a listed character or the person of a photo. */
  source_ref?: string | null;
  source_start_s?: number | null;
  source_end_s?: number | null;
  character?: string | null;
  person_ref?: string | null;
  /** The shot that holds the picture of the new person (one picture for all their shots). */
  person_from?: number | null;
};

export type Region = { x: number; y: number; w: number; h: number };

export type Proposal = {
  id: string; type: string; shot_n: number | null; text: string;
  status: "open" | "accepted" | "rejected"; applied: boolean;
};

export type Board = {
  schema: number;
  shots: StagedShot[];
  order: number[];
  proposals: Proposal[];
  end_card: { text: string | null; url: string | null };
  pronunciations: Record<string, string>;
  scenes?: Record<string, string>;
  costs: { image: number; music: number; captions: number; shots: Record<string, { film: number; lips: number; voice: number }> };
  needs: { n: number; role: "start" | "end" }[];
};

export type Take = {
  id: string; shot_n: number; version: number; storage_key: string; frames_prefix: string | null;
  audio_key: string | null; model: string | null; duration_s: number; voice_end_s: number | null;
  status: "proposed" | "approved" | "rejected" | "failed" | "stale"; cost_usd: number; notes: string | null;
  lips: { where?: string | null; done?: boolean; checked?: boolean; reason?: string; check?: string[]; region?: Region } | null;
};

export type Job = {
  id: string; kind: string; shot_n: number | null; role: string | null; status: "queued" | "running" | "done" | "failed";
  cost_estimate_usd: number; cost_actual_usd: number | null; error: string | null; created_at: string;
  result: Record<string, unknown> | null;
};

export type Join = "cut" | "dissolve" | "fadewhite" | "fadeblack";
export type CaptionBlock = { start: number; end: number; text: string };
export type Montage = {
  joins?: Record<string, Join>;
  trims?: Record<string, number>;
  music?: { on?: boolean; key?: string; under_voice?: number; end_card?: number; prompt?: string };
  captions?: { on?: boolean; shots?: Record<string, { audio_key?: string | null; source?: string; blocks?: CaptionBlock[] }> };
  end_card?: { seconds?: number };
  timeline?: { n: number | "end"; start_s: number; length_s: number; join: Join | null; overlap_s: number }[];
};

/** Mirror of video-engine app/hear.py (STT_USD, MAX_VIDEOS): before the script exists there
 * is no storyboard.costs to read. Each uploaded clip is listened to once so the script is
 * written from what is really said in it. */
export const HEAR_USD = 0.1;
export const HEAR_MAX_VIDEOS = 3;
/** Mirror of video-engine dialogue.MAX_SWAP_S: one shot holds this much of a clip at most. */
export const CLIP_MAX_S = 15;

/** The clip shots whose takes are made from the picture of the person kept on shot n. */
export function shotsOfPerson(b: Board, n: number): number[] {
  const s = b.shots.find(x => x.n === n);
  if (s?.kind !== "clip") return [n];
  return [n, ...b.shots.filter(x => x.n !== n && x.kind === "clip" && x.recipe === "swap" && x.person_from === n).map(x => x.n)];
}

export const STAGED_STATUSES = new Set([
  "script_pending", "script_ready", "script_approved", "images_approved", "shots_ready", "assembling",
]);

export function isStaged(r: { brief?: Record<string, unknown> | null }): boolean {
  return r.brief?.flow === "staged";
}

export function boardOf(r: { storyboard: unknown }): Board | null {
  const b = r.storyboard as Board | null;
  return b && b.schema === 2 && Array.isArray(b.shots) ? b : null;
}

export function shotsInOrder(b: Board): StagedShot[] {
  const by = new Map(b.shots.map(s => [s.n, s]));
  return b.order.map(n => by.get(n)).filter((s): s is StagedShot => !!s);
}

export const ENQUEUE_MESSAGES: Record<string, string> = {
  not_found: "Video not found.",
  not_staged: "This video does not use the step-by-step flow.",
  invalid_status: "This step is not available at this stage of the video.",
  already_queued: "This is already being made. The page refreshes itself.",
  video_not_enabled: "Video is not enabled for this client.",
  weekly_quota_reached: "Weekly quota reached: the next slot opens on Monday.",
  no_estimate: "This step has no price yet. Reload the page.",
  monthly_cap_reached: "This would pass the monthly production budget of your account. Ask Max if you need more.",
};

export async function enqueue(
  svc: SupabaseClient, request: VideoRequest, actor: VideoActor, kind: string,
  opts: { shot?: number | null; role?: "start" | "end" | null; params?: Record<string, unknown>; estimate?: number; change?: string | null } = {},
): Promise<{ ok: boolean; error?: string; reason?: string; job_id?: string }> {
  const { data, error } = await svc.rpc("video_job_enqueue", {
    p_request: request.id, p_kind: kind, p_shot: opts.shot ?? null, p_role: opts.role ?? null,
    p_params: opts.params ?? {}, p_estimate: opts.estimate ?? 0, p_change: opts.change ?? null,
    p_actor: actor.tier.isAdmin ? "admin" : "client", p_actor_id: actor.tier.userId,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { ok: boolean; reason?: string; job_id?: string };
  if (!res.ok) return { ok: false, reason: res.reason, error: ENQUEUE_MESSAGES[res.reason ?? ""] ?? res.reason ?? "refused" };
  return { ok: true, job_id: res.job_id };
}

export function cleanRegion(raw: unknown): Region | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const [x, y, w, h] = ["x", "y", "w", "h"].map(k => Number(r[k]));
  if (![x, y, w, h].every(Number.isFinite) || w < 0.02 || h < 0.02 || x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) return null;
  return { x, y, w, h };
}

const KINDS = new Set(["persona", "pantalla", "silent", "ceo"]);
export type ShotEdit = {
  n: number | null; kind?: string; text?: string; speaker?: string; camera?: string; link?: string;
  lips_where?: string; narration?: string | null; to_phone?: boolean;
  /** kind "clip" only: the stretch of the clip, in its seconds. */
  from_s?: number; to_s?: number;
};

/** Apply the client's own edits of the shot table. The engine lays the table
 * out again and recomputes lengths and prices (script_apply). */
export function applyScriptEdits(board: Board, edits: ShotEdit[], endText: string | null | undefined,
                                 decisions: Record<string, string>): { board: Board; error?: string } {
  if (!edits.length) return { board, error: "the video needs at least one shot" };
  if (edits.length > 12) return { board, error: "at most 12 shots" };
  const by = new Map(board.shots.map(s => [s.n, s as StagedShot & Record<string, unknown>]));
  let next = Math.max(0, ...board.shots.map(s => s.n)) + 1;
  const shots: (StagedShot & Record<string, unknown>)[] = [];
  const order: number[] = [];
  for (const e of edits) {
    const text = String(e.text ?? "").trim().slice(0, 400);
    if (!text) return { board, error: "every shot needs its words (or what happens, for a shot without words)" };
    const kind = KINDS.has(String(e.kind)) ? String(e.kind) : "persona";
    const old = e.n !== null ? by.get(e.n) : undefined;
    const s = (old ? { ...old } : { n: next++, text_by: "client", link_edited: true }) as StagedShot & Record<string, unknown>;
    if (order.includes(s.n)) continue;
    if (old && old.text !== text) s.text_by = "client";
    if (old && old.kind === "clip") {
      if (e.from_s !== undefined || e.to_s !== undefined) {
        const a = Math.round(Number(e.from_s) * 100) / 100, b = Math.round(Number(e.to_s) * 100) / 100;
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b - a < 0.5) {
          return { board, error: "a shot from your clip needs a start and an end at least half a second apart" };
        }
        if (b - a > CLIP_MAX_S + 0.001) return { board, error: `one shot holds at most ${CLIP_MAX_S} seconds of your clip` };
        if (a !== Number(old.source_start_s ?? 0) || b !== Number(old.source_end_s ?? -1)) {
          // The engine reads the words said in the new stretch when it applies the script.
          s.source_start_s = a; s.source_end_s = b; s.duration_s = Math.round((b - a) * 100) / 100; s.stretch_edited = true;
        }
      }
      s.text = old.text; s.text_by = old.text_by;
      shots.push(s); order.push(s.n); continue;
    }
    s.text = text;
    s.kind = kind as StagedShot["kind"];
    s.speaker = kind === "silent" ? "" : String(e.speaker ?? "").trim().slice(0, 60);
    const camera = String(e.camera ?? "").trim().slice(0, 500);
    if (camera !== String(s.camera ?? "")) { s.camera = camera; s.camera_edited = !!camera; }
    const link = e.link === "continuity" ? "continuity" : "cut";
    if (link !== s.link) { s.link = link; s.link_edited = true; }
    if (kind !== "silent") {
      const where = e.lips_where === "phone" || e.lips_where === "face" ? e.lips_where : (kind === "pantalla" ? "phone" : "face");
      s.lips = { ...(s.lips ?? {}), where };
      s.narration = null;
    } else {
      s.narration = String(e.narration ?? "").trim().slice(0, 300) || null;
    }
    s.to_phone = kind === "persona" && !!e.to_phone;
    s.line = null;
    shots.push(s);
    order.push(s.n);
  }
  const proposals = board.proposals.map(p =>
    !p.applied && ["accepted", "rejected", "open"].includes(decisions[p.id] ?? "")
      ? { ...p, status: decisions[p.id] as Proposal["status"] } : p);
  const end_card = endText === undefined ? board.end_card
    : { ...board.end_card, text: String(endText ?? "").trim().slice(0, 300) || null };
  return { board: { ...board, shots, order, proposals, end_card } };
}

const JOINS = new Set(["cut", "dissolve", "fadewhite", "fadeblack"]);

/** Montage settings the panel may write; everything else in the column is the engine's. */
export function cleanMontage(old: Montage, raw: Record<string, unknown>): Montage {
  const out: Montage = { ...old };
  if (raw.joins && typeof raw.joins === "object") {
    out.joins = Object.fromEntries(Object.entries(raw.joins as Record<string, unknown>)
      .filter(([k, v]) => /^\d+>(\d+|end)$/.test(k) && JOINS.has(String(v))).slice(0, 20)) as Record<string, Join>;
  }
  if (raw.trims && typeof raw.trims === "object") {
    out.trims = Object.fromEntries(Object.entries(raw.trims as Record<string, unknown>)
      .filter(([k, v]) => /^\d+$/.test(k) && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 15)
      .map(([k, v]) => [k, Math.round(Number(v) * 100) / 100]).slice(0, 20));
  }
  if (raw.music && typeof raw.music === "object") {
    const m = raw.music as Record<string, unknown>;
    const lvl = (v: unknown, d: number, max: number) => Number.isFinite(Number(v)) ? Math.min(Math.max(Number(v), 0), max) : d;
    out.music = { ...(old.music ?? {}), on: m.on !== false,
      under_voice: lvl(m.under_voice, old.music?.under_voice ?? 0.09, 0.5),
      end_card: lvl(m.end_card, old.music?.end_card ?? 0.25, 0.8) };
  }
  if (raw.captions && typeof raw.captions === "object") {
    const c = raw.captions as Record<string, unknown>;
    const kept = { ...(old.captions?.shots ?? {}) };
    if (c.shots && typeof c.shots === "object") {
      for (const [n, v] of Object.entries(c.shots as Record<string, { blocks?: unknown }>)) {
        if (!kept[n] || !Array.isArray(v?.blocks)) continue;
        // Only the words: the timings are the transcription's.
        const blocks = (kept[n].blocks ?? []).map((b, i) => {
          const t = String((v.blocks as { text?: unknown }[])[i]?.text ?? b.text).trim().slice(0, 80);
          return { ...b, text: t || b.text };
        });
        kept[n] = { ...kept[n], blocks, source: "edited" };
      }
    }
    out.captions = { on: c.on !== false, shots: kept };
  }
  if (raw.end_card && typeof raw.end_card === "object") {
    const s = Number((raw.end_card as Record<string, unknown>).seconds);
    if (Number.isFinite(s)) out.end_card = { seconds: Math.min(Math.max(s, 1.5), 10) };
  }
  return out;
}
