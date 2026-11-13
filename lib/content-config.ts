/** Per-client switches of the Content screen. Keys are content slugs
 * (content_calendar.content_slug), not the outreach slug. */

/** Clients whose people never use the prepared comment replies (Jana, 13-11-2026:
 * "Die benutze ich nicht. Die beantworte ich selber"). Their panel is not drawn and
 * its rows are not even sent to the browser. The engine keeps drafting them; nothing
 * is deleted. To turn it back on for a client, take the slug out of this list (or
 * set CONTENT_COMMENT_REPLIES_OFF to the slugs that should stay off, comma separated,
 * empty for none) and deploy. */
const COMMENT_REPLIES_OFF_DEFAULT = ["operandi-madeleine-scholl"];

export function commentRepliesOff(): string[] {
  const env = process.env.CONTENT_COMMENT_REPLIES_OFF;
  if (env === undefined) return COMMENT_REPLIES_OFF_DEFAULT;
  return env.split(",").map(s => s.trim()).filter(Boolean);
}

/** Language of the person, when the client has one. Dates follow it (Madeleine and Jana
 * work in German: dd.mm.yyyy, 24 h). Without an entry the browser's own language is used. */
export const LOCALE_BY_CONTENT_SLUG: Record<string, string> = {
  "operandi-madeleine-scholl": "de-DE",
};
