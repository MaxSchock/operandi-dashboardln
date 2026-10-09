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
  kind: "persona" | "pantalla" | "silent" | "ceo" | "clip" | "text" | "motion" | "launch";
  /** kind "launch": a scene of a product launch video, with what the engine planned to show in it. */
  show?: { role: string; shows: string; /** The same, in the client's words and language. */ seen?: string; screen?: number } | null;
  /** kind "motion": what the drawn shot shows besides its words, one of the client's own pictures or a short list. */
  card?: { role: "screen" | "points"; image: string | null; points: string[] } | null;
  text: string;
  speaker: string;
  text_by?: "client" | "agent" | "clip";
  /** kind "clip": the language heard in that stretch. */
  source_lang?: string | null;
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
   * its person replaced (recipe "swap") by a listed character or the person of a photo, or
   * made new (recipe "host"): that person films it as a new presenter, the screen of the
   * clip laid over the picture. */
  source_ref?: string | null;
  source_start_s?: number | null;
  source_end_s?: number | null;
  character?: string | null;
  person_ref?: string | null;
  /** recipe "host" with no clip behind: the presenter is a person of the client's product page. */
  from_site?: boolean;
  /** recipe "host" with no clip behind: the presenter talks to the camera between the other shots. */
  solo?: boolean;
  /** What the shot will show, put together by the engine from material that already exists (free). */
  sketch?: { key: string; what: string; says: string } | null;
  /** The shot that holds the picture of the new person (one picture for all their shots). */
  person_from?: number | null;
  /** kind "clip": the stretch said in another language (a new voice, the lips moved to it).
   * `of` is the heard text the translation was made from. */
  dub?: { lang: string; text: string; of: string } | null;
  /** recipe "host": what the montage lays over the presenter (the engine works it out). */
  overlays?: { type: "video" | "label"; box: Region; show: [number, number]; kind?: string; text?: string; items?: string[] }[] | null;
  /** Words shown on screen during the shot: a script of its own, read before anything is heard. */
  on_screen?: string | null;
  /** Second of the shot where the montage pushes in (a change of picture without filming). */
  punch_in_s?: number | null;
};

export type Region = { x: number; y: number; w: number; h: number };

export type Proposal = {
  id: string; type: string; shot_n: number | null; text: string;
  status: "open" | "accepted" | "rejected"; applied: boolean;
  /** type "hook": what the engine's checks found in this opening. */
  notes?: string[];
};

/** What the engine's checks find in the table as it stands (app/retain.py). Shown, never enforced. */
export type Advice = { type: string; shot_n: number | null; text: string };

export type Board = {
  /** A video with animated scenes of the client's page: the page, and who presents it (if anyone). */
  launch?: { url?: string; presenter?: { from?: string; name?: string | null; file?: string; key?: string; section?: string | null } | null;
    /** A presenter was wanted and the page puts no person forward: nobody was made up. */
    nobody_on_page?: boolean } | null;
  schema: number;
  shots: StagedShot[];
  order: number[];
  proposals: Proposal[];
  end_card: { text: string | null; url: string | null };
  pronunciations: Record<string, string>;
  scenes?: Record<string, string>;
  costs: { image: number; music: number; captions: number; shots: Record<string, { film: number; lips: number; voice: number }> };
  needs: { n: number; role: "start" | "end" }[];
  advice?: Advice[];
  /** A drawn video: screens the story would need and the client did not upload (nothing is invented in their place). */
  missing?: string[];
  /** Per clip whose person is replaced: the people seen in it and which one is replaced
   * (index). With several people and no answer the script cannot be approved. */
  clip_people?: Record<string, { people: string[]; who: number | null; by?: string }>;
  /** Per clip made with a new presenter: where its screen and its other people are, and
   * whether the screen is shown while one of them covers it ("keep") or not ("remove"). */
  clip_layout?: Record<string, { boxes?: unknown[]; people?: unknown[]; labels?: unknown[]; others?: "remove" | "keep" }>;
};

export const isHost = (s: StagedShot) => s.kind === "clip" && s.recipe === "host";
/** A shot of the client's clip made with another person: one picture of that person for all of them. */
export const personClip = (s: StagedShot) => s.kind === "clip" && (s.recipe === "swap" || s.recipe === "host");

/** The clips made with a new presenter in which other people stand in front of the screen. */
export function othersIn(b: Board): string[] {
  return Object.entries(b.clip_layout ?? {}).filter(([ref, l]) => (l.people?.length ?? 0) > 0
    && b.shots.some(s => isHost(s) && s.source_ref === ref)).map(([ref]) => ref);
}

/** The clips with several people where nobody said yet who is replaced. */
export function whoMissing(b: Board, answers: Record<string, number | null> = {}): string[] {
  const out: string[] = [];
  for (const s of b.shots) {
    const ref = s.source_ref ?? "";
    if (s.kind !== "clip" || s.recipe !== "swap" || !ref || out.includes(ref)) continue;
    const cp = b.clip_people?.[ref];
    const who = ref in answers ? answers[ref] : cp?.who;
    if (cp && cp.people.length > 1 && !(Number.isInteger(who) && who! >= 0 && who! < cp.people.length)) out.push(ref);
  }
  return out;
}

export type Take = {
  id: string; shot_n: number; version: number; storage_key: string; frames_prefix: string | null;
  audio_key: string | null; model: string | null; duration_s: number; voice_end_s: number | null;
  status: "proposed" | "approved" | "rejected" | "failed" | "stale"; cost_usd: number; notes: string | null;
  lips: { where?: string | null; done?: boolean; checked?: boolean; reason?: string; check?: string[]; region?: Region;
    recipe?: string; dub?: string; dub_failed?: string;
    /** A filmed presenter: what the engine saw on the hands (a ring, something held) that the picture does not have. */
    hands?: { ok: boolean; what?: string; at_s?: number; key?: string | null } | null } | null;
};

export type Job = {
  id: string; kind: string; shot_n: number | null; role: string | null; status: "queued" | "running" | "done" | "failed";
  cost_estimate_usd: number; cost_actual_usd: number | null; error: string | null; created_at: string;
  result: Record<string, unknown> | null;
};

/** How a vertical video is laid out. split: a filmed shot with words on screen shows the person
 * below and those words as a graphics panel above, with captions that go word by word. */
export const LAYOUTS = { full: "Full frame", split: "Person below, graphics above" } as const;
export type Layout = keyof typeof LAYOUTS;
export const SAFE_ZONES = { reels: "Instagram, TikTok, Shorts", linkedin: "LinkedIn", none: "No margin (edge of the video)" } as const;
export type Safe = keyof typeof SAFE_ZONES;
/** Mirror of video-engine retain.ON_SCREEN_MAX_CHARS. */
export const ON_SCREEN_MAX_CHARS = 60;
export type Join = "cut" | "dissolve" | "fadewhite" | "fadeblack";
export type CaptionBlock = { start: number; end: number; text: string };
export type Montage = {
  joins?: Record<string, Join>;
  trims?: Record<string, number>;
  music?: { on?: boolean; key?: string; under_voice?: number; end_card?: number; prompt?: string };
  captions?: { on?: boolean; shots?: Record<string, { audio_key?: string | null; source?: string; blocks?: CaptionBlock[] }> };
  end_card?: { seconds?: number };
  /** Where captions and words on screen may sit on a vertical video: inside what the
   * network's own buttons leave free. Engine default: reels. */
  safe?: Safe;
  layout?: Layout;
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
  return [n, ...b.shots.filter(x => x.n !== n && personClip(x) && x.person_from === n).map(x => x.n)];
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
export const TEXT_MAX_CHARS = 160;
/** A video the engine draws itself, for free: words on screen (kind "text"), some with one of the
 * client's own pictures or a short list (kind "motion"). No voice, nothing filmed. */
export const isDrawn = (kind: string | undefined) => kind === "text" || kind === "motion" || kind === "launch";
/** A product launch video: every shot is a scene of one animated page the engine writes from the
 * client's product page (kind "launch"). Its words are up to three short lines, one per line. */
export const isLaunchBoard = (b: Board) => b.shots.length > 0 && b.shots.every(s => s.kind === "launch");
/** A product launch video, with or without a presenter between its scenes. */
export const hasLaunch = (b: Board) => b.shots.some(s => s.kind === "launch");
export const LAUNCH_MAX_CHARS = 300;
/** What a presenter taken from the product page says in one shot. */
export const HOST_SITE_MAX_CHARS = 90;
export const isTextBoard = (b: Board) => b.shots.length > 0 && b.shots.every(s => isDrawn(s.kind));
export const CARD_POINTS = 3;
export type ShotEdit = {
  n: number | null; kind?: string; text?: string; speaker?: string; camera?: string; link?: string;
  lips_where?: string; narration?: string | null; to_phone?: boolean;
  /** Words on screen during the shot (not for a card of text, which is its own words). */
  on_screen?: string;
  /** A drawn shot: the file name of the picture it shows, or its points (one per line). A picture wins. */
  card_image?: string; card_points?: string;
  /** kind "clip" only: the stretch of the clip, in its seconds. */
  from_s?: number; to_s?: number;
  /** kind "clip", dubbed: the translated words (empty: translate again), or the dubbing taken off. */
  dub_text?: string; dub_off?: boolean;
  /** kind "clip", heard in another language than the video's: have this shot said in the video's language. */
  dub_on?: boolean;
};

/** A stretch of the client's clip whose words were heard in another language than the video's: it can be dubbed. */
export const canDub = (s: StagedShot, lang: string | undefined) =>
  s.kind === "clip" && s.recipe !== "host" && s.text_by === "clip" && !!lang && !!s.source_lang && s.source_lang !== lang && !!LANG_NAMES[lang];

export const LANG_NAMES: Record<string, string> = { de: "German", en: "English", fr: "French", nl: "Dutch", es: "Spanish" };

/** Apply the client's own edits of the shot table. The engine lays the table
 * out again and recomputes lengths and prices (script_apply). */
const onScreen = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, ON_SCREEN_MAX_CHARS) || null;

export function applyScriptEdits(board: Board, edits: ShotEdit[], endText: string | null | undefined,
                                 decisions: Record<string, string>,
                                 who: Record<string, unknown> = {}, lang?: string,
                                 others: Record<string, unknown> = {}): { board: Board; error?: string } {
  if (!edits.length) return { board, error: "the video needs at least one shot" };
  if (edits.length > 12) return { board, error: "at most 12 shots" };
  const by = new Map(board.shots.map(s => [s.n, s as StagedShot & Record<string, unknown>]));
  let next = Math.max(0, ...board.shots.map(s => s.n)) + 1;
  const shots: (StagedShot & Record<string, unknown>)[] = [];
  const order: number[] = [];
  // A video of text on screen holds only cards of text: every shot of it is one.
  const textBoard = isTextBoard(board);
  const launchVideo = hasLaunch(board);
  for (const e of edits) {
    // In a product launch video every row but the presenter's is a scene.
    const launchBoard = launchVideo && (e.n === null ? e.kind === "launch" : by.get(e.n)?.kind === "launch");
    const text = launchBoard
      ? String(e.text ?? "").split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3).join("\n").slice(0, LAUNCH_MAX_CHARS)
      : String(e.text ?? "").trim().slice(0, textBoard ? TEXT_MAX_CHARS : 400);
    if (!text) return { board, error: "every shot needs its words (or what happens, for a shot without words)" };
    const kind = launchBoard ? "launch" : textBoard ? "text" : KINDS.has(String(e.kind)) ? String(e.kind) : "persona";
    const old = e.n !== null ? by.get(e.n) : undefined;
    const s = (old ? { ...old } : { n: next++, text_by: "client", link_edited: true }) as StagedShot & Record<string, unknown>;
    if (order.includes(s.n)) continue;
    if (old && old.text !== text) s.text_by = "client";
    if (old && old.kind === "clip" && (old.solo || old.from_site)) {
      // A presenter taken from the product page: there is no clip behind, only the words said.
      const said = String(e.text ?? "").replace(/\s+/g, " ").trim().slice(0, HOST_SITE_MAX_CHARS) || old.text;
      if (said !== old.text) { s.text = said; s.text_by = "client"; } else { s.text = old.text; s.text_by = old.text_by; }
      shots.push(s); order.push(s.n); continue;
    }
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
      if (e.on_screen !== undefined) s.on_screen = onScreen(e.on_screen);
      // A new presenter always speaks the video's language: that dubbing is not taken off.
      if (old.dub && e.dub_off && old.recipe !== "host") delete s.dub;
      else if (old.dub && e.dub_text !== undefined) {
        // Emptied: the engine translates it again when it applies the script.
        s.dub = { ...old.dub, text: String(e.dub_text).trim().slice(0, 600) };
      } else if (!old.dub && e.dub_on && canDub(old, lang)) {
        // The engine translates the words when it applies the script, and prices the voice and the lips.
        s.dub = { lang: lang as string, text: "", of: "" };
      }
      shots.push(s); order.push(s.n); continue;
    }
    s.text = text;
    s.kind = kind as StagedShot["kind"];
    if (kind === "launch") {
      s.speaker = ""; s.link = "cut"; s.narration = null; s.line = null; s.to_phone = false; s.card = null;
      // A scene the client adds: the engine decides what it shows when it draws the page.
      if (!s.show) s.show = { role: "highlight", shows: "" };
      shots.push(s); order.push(s.n); continue;
    }
    if (kind === "text") {
      s.speaker = ""; s.link = "cut"; s.narration = null; s.line = null; s.to_phone = false;
      // The engine checks the picture against the client's files and decides the kind.
      const image = String(e.card_image ?? "").trim().slice(0, 200);
      const points = String(e.card_points ?? "").split("\n").map(p => p.replace(/\s+/g, " ").trim().slice(0, 70)).filter(Boolean).slice(0, CARD_POINTS);
      s.card = image ? { role: "screen", image, points: [] } : points.length ? { role: "points", image: null, points } : null;
      s.kind = s.card ? "motion" : "text";
      shots.push(s); order.push(s.n); continue;
    }
    if (e.on_screen !== undefined) s.on_screen = onScreen(e.on_screen);
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
  // Who in a clip with several people is replaced: only an index of the list the engine saw.
  const clip_people = { ...(board.clip_people ?? {}) };
  for (const [ref, v] of Object.entries(who)) {
    const cp = clip_people[ref];
    if (cp && Number.isInteger(v) && (v as number) >= 0 && (v as number) < cp.people.length && cp.who !== v) {
      clip_people[ref] = { ...cp, who: v as number, by: "client" };
    }
  }
  // The other people of a clip made with a new presenter: the engine lays the screen out again.
  const clip_layout = { ...(board.clip_layout ?? {}) };
  const asked = new Set(othersIn(board));
  for (const [ref, v] of Object.entries(others)) {
    if (asked.has(ref) && (v === "keep" || v === "remove")) clip_layout[ref] = { ...clip_layout[ref], others: v };
  }
  return { board: { ...board, shots, order, proposals, end_card, ...(board.clip_people ? { clip_people } : {}),
                    ...(board.clip_layout ? { clip_layout } : {}) } };
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
  if (typeof raw.safe === "string" && raw.safe in SAFE_ZONES) out.safe = raw.safe as Safe;
  if (typeof raw.layout === "string" && raw.layout in LAYOUTS) out.layout = raw.layout as Layout;
  if (raw.end_card && typeof raw.end_card === "object") {
    const s = Number((raw.end_card as Record<string, unknown>).seconds);
    if (Number.isFinite(s)) out.end_card = { seconds: Math.min(Math.max(s, 1.5), 10) };
  }
  return out;
}
