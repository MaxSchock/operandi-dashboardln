import type { CalendarRow } from "@/lib/content-load";

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(?:[?#].*)?$/i;

export type PostMedia =
  | { kind: "video"; src: string }
  | { kind: "image"; src: string; fallback: string | null }
  | { kind: "none" };

/** A file link whose path ends like a video. Video posts keep their file in
 * image_url_imgbb as well (it is the field the publisher reads), so the link
 * alone can say what the card must draw. */
export function looksLikeVideo(url: string | null | undefined): boolean {
  return !!url && VIDEO_EXT.test(url.trim());
}

/** What a post card draws in the place of the picture. A video is never handed
 * to an <img>: the browser shows its broken-image icon for it. */
export function mediaOf(r: Pick<CalendarRow, "post_type" | "video_url" | "image_url_imgbb" | "image_url_source">): PostMedia {
  const type = (r.post_type ?? "").trim().toLowerCase();
  const links = [r.video_url, r.image_url_imgbb, r.image_url_source].map(u => (u ?? "").trim()).filter(Boolean);
  // A Video post's file is its first link even when the host path has no extension.
  const video = (r.video_url ?? "").trim()
    || links.find(looksLikeVideo)
    || (type === "video" ? links[0] ?? "" : "");
  if (video) return { kind: "video", src: video };
  const imgs = links.filter(u => !looksLikeVideo(u));
  const src = (r.image_url_imgbb ?? "").trim() && !looksLikeVideo(r.image_url_imgbb) ? r.image_url_imgbb!.trim() : imgs[0];
  if (!src) return { kind: "none" };
  const fallback = (r.image_url_source ?? "").trim();
  return { kind: "image", src, fallback: fallback && fallback !== src && !looksLikeVideo(fallback) ? fallback : null };
}
