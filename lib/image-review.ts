import type { CalendarRow } from "@/lib/content-load";

/** One check of a generated picture by the engine's reviewer (daemon, 10-11-2026). */
export type ImageReview = {
  stage?: string;
  verdict?: "pass" | "fail" | "unreviewed" | string;
  issues?: { area?: string; severity?: string; description?: string }[];
  reason?: string;
  model?: string;
  at?: string;
  image_url?: string;
};

type Row = Pick<CalendarRow, "image_status" | "image_url_imgbb" | "image_url_source"> & {
  image_notes?: string | null;
  image_review?: ImageReview | null;
};

/** Marks the engine puts at the start of each line it writes (rejection_kinds.py). */
const ENGINE_MARKS = ["auto:", "\u26a0", "sage_flagged:"];
const engineLine = (line: string) => ENGINE_MARKS.some(m => line.trim().toLowerCase().startsWith(m));
const lines = (notes: string | null | undefined) => (notes ?? "").split("\n").map(l => l.trim()).filter(Boolean);
/** Every line comes from the engine: no person has asked for anything since. The daemon
 * judges who wrote a note line by line, so one line written by a person under an engine
 * line means a person asked for a new picture. */
export function engineOnly(notes: string | null | undefined): boolean {
  const ls = lines(notes);
  return ls.length > 0 && ls.every(engineLine);
}

/** "In progress" is also where the engine parks a picture its reviewer rejected,
 * with its note. While regenerating, the note is still the person's request, so a
 * parked picture is the one whose note comes from the engine: nothing is being drawn. */
export function imageParked(r: Row): boolean {
  return r.image_status === "In progress" && engineOnly(r.image_notes);
}

/** The verdict that belongs to the picture shown. A picture uploaded by hand or
 * drawn before the verdict was kept has none. */
export function currentReview(r: Row): ImageReview | null {
  const v = r.image_review;
  if (!v || typeof v !== "object" || !v.verdict) return null;
  const shown = [r.image_url_imgbb, r.image_url_source].filter(Boolean);
  if (v.image_url && shown.length && !shown.includes(v.image_url)) return null;
  return v;
}

export type ImageCheck = { tone: "red" | "amber" | "slate"; label: string; issues: string[] } | null;

/** What the card says about the picture's check, or null when there is nothing to say. */
export function imageCheck(r: Row): ImageCheck {
  // Once a person approved the picture (or it went out), the check has done its job.
  if (r.image_status === "Approved" || r.image_status === "Published") return null;
  const v = currentReview(r);
  const issues = (Array.isArray(v?.issues) ? v!.issues : [])
    .map(i => String(i?.description ?? "").trim()).filter(Boolean);
  if (v?.verdict === "fail" || imageParked(r)) {
    return { tone: "red", label: "flagged by the image reviewer", issues };
  }
  if (v?.verdict === "unreviewed") {
    return { tone: "amber", label: "image not checked automatically", issues: [] };
  }
  if (v?.verdict === "pass" && issues.length) {
    return { tone: "slate", label: "reviewer remarks", issues };
  }
  return null;
}

/** The image notes worth showing next to the picture. Engine lines describe the
 * picture they were written about: once that picture has been replaced by hand
 * (the verdict no longer matches) or a person approved it, they are left out. A person's lines always show. */
export function imageNotesShown(r: Row): string {
  const ls = lines(r.image_notes);
  if (!ls.length) return "";
  const done = r.image_status === "Approved" || r.image_status === "Published";
  const stale = done || !imageParked(r) && r.image_review && typeof r.image_review === "object" && r.image_review.verdict && !currentReview(r);
  return ls.filter(l => !(stale && engineLine(l))).join("\n");
}
