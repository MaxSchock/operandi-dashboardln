/** Pure helpers of the Content screen (no imports from the app, so node can test them). */

/** The zone the engine schedules in: one zone on the server and in the browser. */
export const ZONE = "Europe/Berlin";
/** A post created less than this long ago is "new". */
export const NEW_WINDOW_MS = 24 * 3600 * 1000;

/** The locale dates are written in: the client's own, else the browser's first language
 * (Accept-Language), else British English. A tag Intl does not know is skipped. */
export function pickLocale(configured?: string | null, acceptLanguage?: string | null, fallback = "en-GB"): string {
  const valid = (tag: string) => {
    try { return Intl.getCanonicalLocales(tag)[0] ?? null; } catch { return null; }
  };
  if (configured) { const c = valid(configured); if (c) return c; }
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim();
    if (!tag || tag === "*") continue;
    const c = valid(tag);
    if (c) return c;
  }
  return fallback;
}

const DT: Intl.DateTimeFormatOptions = { timeZone: ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const D: Intl.DateTimeFormatOptions = { timeZone: ZONE, day: "2-digit", month: "2-digit", year: "numeric" };

export function fmtDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(locale, DT);
}
export function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(locale, D);
}

/** Created in the last 24 hours. Without a creation time nothing is claimed. */
export function isJustCreated(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t >= 0 && now - t < NEW_WINDOW_MS;
}

export type PostLike = {
  post_type: string | null;
  text_status: string | null;
  image_status: string | null;
  published_at: string | null;
  scheduled_for: string | null;
  created_at?: string | null;
};

/** What the badge says. The same rules the card always used: a post is only ready for the
 * publisher when text and image are both approved. */
export function postStatus(r: PostLike): string {
  const textOnly = (r.post_type ?? "").toLowerCase() === "text";
  const textStatus = r.text_status ?? "New";
  const imageApproved = textOnly || r.image_status === "Approved" || r.image_status === "Published";
  if (r.published_at) return "Published";
  if (textStatus === "Approved" && !imageApproved) return "Under review";
  return textStatus;
}

/** The name people see for a status. The engine's "New" means "nobody has approved it". */
export function statusLabel(status: string): string {
  return status === "New" ? "To review" : status;
}

export type PostTab = "review" | "scheduled" | "published" | "suspended";

export function postTab(r: PostLike): PostTab {
  const s = postStatus(r);
  if (s === "Published") return "published";
  if (s === "Approved") return "scheduled";
  if (s === "Suspended") return "suspended";
  return "review";
}

const ts = (iso: string | null | undefined, missing: number) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : missing;
};

const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

/** To review: newest creation first. Scheduled: soonest first. Published: latest first. */
export function sortForTab<T extends PostLike>(posts: T[], tab: PostTab): T[] {
  const out = [...posts];
  if (tab === "scheduled") out.sort((a, b) => cmp(ts(a.scheduled_for, Infinity), ts(b.scheduled_for, Infinity)));
  else if (tab === "published") out.sort((a, b) => cmp(ts(b.published_at, -Infinity), ts(a.published_at, -Infinity)));
  else out.sort((a, b) => cmp(ts(b.created_at, -Infinity), ts(a.created_at, -Infinity)) || cmp(ts(b.scheduled_for, -Infinity), ts(a.scheduled_for, -Infinity)));
  return out;
}

/** The posts that came after the ones known when the person pressed Generate, oldest
 * first and no more than were asked for. */
export function arrivedSince<T extends { post_id: string; created_at?: string | null }>(posts: T[], known: string[], asked: number): T[] {
  return posts
    .filter(p => !known.includes(p.post_id))
    .sort((a, b) => cmp(ts(a.created_at, Infinity), ts(b.created_at, Infinity)))
    .slice(0, Math.max(0, asked));
}
