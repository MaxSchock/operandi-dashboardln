/** Per-client switches of the Content screen. Keys are content slugs
 * (content_calendar.content_slug), not the outreach slug. */

/** Clients whose people never use the prepared comment replies (Jana, 13-11-2026:
 * "Die benutze ich nicht. Die beantworte ich selber"). Their panel is not drawn and
 * its rows are not even sent to the client's browser; the Operandi admin still sees them.
 * The engine keeps drafting them; nothing is deleted. To turn it back on for a client,
 * take the slug out of this list (or set CONTENT_COMMENT_REPLIES_OFF to the slugs that
 * should stay off, comma separated, empty for none) and deploy. */
const COMMENT_REPLIES_OFF_DEFAULT = ["operandi-madeleine-scholl"];

export function commentRepliesOff(): string[] {
  const env = process.env.CONTENT_COMMENT_REPLIES_OFF;
  if (env === undefined) return COMMENT_REPLIES_OFF_DEFAULT;
  return env.split(",").map(s => s.trim()).filter(Boolean);
}

/** What is known about a content client without reading any of its posts: the outreach
 * slug its people sign in with (client_users.client_slug) and the language they work in
 * (Madeleine and Jana: German, dd.mm.yyyy, 24 h). Without an entry the browser's own
 * language is used. */
export const CONTENT_CLIENTS: Record<string, { outreachSlug: string; locale?: string }> = {
  "operandi-madeleine-scholl": { outreachSlug: "madeleine", locale: "de-DE" },
};

export const LOCALE_BY_CONTENT_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(CONTENT_CLIENTS).filter(([, v]) => v.locale).map(([k, v]) => [k, v.locale as string]),
);

/** The configured language of the person who signs in as this outreach client, if any.
 * It does not depend on the client having visible posts yet. */
export function localeForOutreach(outreachSlug: string | null | undefined): string | null {
  if (!outreachSlug) return null;
  for (const v of Object.values(CONTENT_CLIENTS)) if (v.outreachSlug === outreachSlug && v.locale) return v.locale;
  return null;
}
