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

/** The engine always starts its own notes with "auto:". */
const engineNote = (notes: string | null | undefined) => (notes ?? "").trim().toLowerCase().startsWith("auto:");

/** "In progress" is also where the engine parks a picture its reviewer rejected,
 * with its note. While regenerating, the note is still the person's request, so a
 * parked picture is the one whose note comes from the engine: nothing is being drawn. */
export function imageParked(r: Row): boolean {
  return r.image_status === "In progress" && engineNote(r.image_notes);
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
  const v = currentReview(r);
  const issues = (v?.issues ?? []).map(i => (i?.description ?? "").trim()).filter(Boolean);
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
