/**
 * Dialogue videos: the client writes every line and who says it; the engine
 * turns each line into one shot (app/dialogue.py in video-engine). Shared by
 * the form (live estimate) and the API (validation), so both agree.
 *
 * Kinds of shot:
 *   ceo       a person from the client's character sheets talks to the camera
 *   persona   an invented person talks (to the camera, or into a phone)
 *   pantalla  the client's own phone clip; its screen shows the app and the
 *             person in the app's video window says the line
 */
export const DIALOGUE_KINDS = ["ceo", "persona", "pantalla"] as const;
export type DialogueKind = (typeof DIALOGUE_KINDS)[number];

/** ElevenLabs voices the voice changer takes for invented people. */
export const CHANGER_VOICES = ["Charlotte", "Sarah", "Alice", "Matilda", "Lily", "Jessica", "Laura", "Aria",
  "George", "Daniel", "Brian", "Liam", "Chris", "Eric", "Will", "Roger", "Charlie", "Callum", "Bill", "River"] as const;

export const MAX_LINES = 8;
export const MAX_LINE_CHARS = 200;
export const END_CARD_S = 1.5;

export type DialogueLine = {
  speaker: string;
  text: string;
  kind: DialogueKind;
  to_phone: boolean;
  voice: string | null;
  clip_start_s: number | null;
  badge: string | null;
};

/** Seconds a line takes, before the recording exists (the engine then uses
 * the real length of the voiced line). */
export function lineSeconds(line: Pick<DialogueLine, "text" | "kind">): number {
  const words = line.text.trim().split(/\s+/).filter(Boolean).length;
  const est = words / 2.5 + 0.8;
  return Math.round(Math.max(est, line.kind === "pantalla" ? 3 : 2) * 10) / 10;
}

export function dialogueSeconds(lines: Pick<DialogueLine, "text" | "kind">[]): number {
  return Math.ceil(lines.reduce((s, l) => s + lineSeconds(l), 0) + END_CARD_S);
}

/** fal prices of 2026-09-28 (per model page). Conservative: the lip-sync of a
 * person shot is counted on the full generated clip, a retry is not. */
export function dialogueCostUsd(lines: Pick<DialogueLine, "text" | "kind">[]): number {
  let usd = 0.2; // music
  for (const l of lines) {
    const s = lineSeconds(l);
    usd += 0.02; // voice conversion or TTS
    if (l.kind === "pantalla") usd += 0.168 * Math.max(s, 3.2) + 0.07 * Math.max(s, 3.2);
    else usd += 0.15 + 0.06 * Math.max(5, Math.ceil(s)) + 0.07 * (s + 0.1);
  }
  return Math.round(usd * 100) / 100;
}

/** Validate and clean what the form sent. Returns the lines or an error. */
export function parseLines(raw: unknown): { lines: DialogueLine[]; error: string | null } {
  if (!Array.isArray(raw) || raw.length === 0) return { lines: [], error: "write at least one line" };
  if (raw.length > MAX_LINES) return { lines: [], error: `at most ${MAX_LINES} lines` };
  const lines: DialogueLine[] = [];
  for (const [i, r] of raw.entries()) {
    const o = (r ?? {}) as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    if (!text) return { lines: [], error: `line ${i + 1} is empty` };
    if (text.length > MAX_LINE_CHARS) return { lines: [], error: `line ${i + 1} is longer than ${MAX_LINE_CHARS} characters` };
    const kind = (DIALOGUE_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as DialogueKind) : "persona";
    const start = o.clip_start_s === null || o.clip_start_s === "" || o.clip_start_s === undefined ? null : Number(o.clip_start_s);
    const voice = (CHANGER_VOICES as readonly string[]).includes(String(o.voice)) ? String(o.voice) : null;
    lines.push({
      speaker: String(o.speaker ?? "").trim().slice(0, 60),
      text,
      kind,
      to_phone: kind === "persona" && !!o.to_phone,
      voice: kind === "persona" ? voice : null,
      clip_start_s: kind === "pantalla" && start !== null && Number.isFinite(start) && start >= 0 ? Math.round(start * 10) / 10 : null,
      badge: String(o.badge ?? "").trim().slice(0, 40) || null,
    });
  }
  return { lines, error: null };
}

/** Paid redos of a single scene per delivered video (engine: MAX_SHOT_REDOS). */
export const MAX_SCENE_REDOS = 3;
export type RedoWhat = "image" | "motion" | "voice";

/** Worst case of redoing one scene (a 6 s line). */
export function sceneRedoCostUsd(kind: string, what: RedoWhat): number {
  const s = 6;
  const lipsync = 0.07 * s;
  if (what === "voice") return Math.round((0.02 + lipsync) * 100) / 100;
  const footage = kind === "pantalla" ? 0.168 * s : 0.06 * s + (what === "image" ? 0.15 : 0);
  return Math.round((0.02 + footage + lipsync) * 100) / 100;
}
