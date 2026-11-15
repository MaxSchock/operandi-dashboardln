/**
 * Line breaks of free text typed by a person in a textarea.
 *
 * A browser turns every line break of a textarea into CRLF when it builds the form
 * body (HTML spec, "normalize newlines" on submit), so a post saved with "Edit text"
 * arrived with one "\r" per break and was stored that way. The server keeps "\n" only.
 * No imports from the app, so node can test it.
 */
export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/** Fields of the content-post body that hold text written by a person. */
export const FREE_TEXT_FIELDS = ["text", "notes"] as const;

/** Returns a copy of the payload with the line breaks of its free-text fields normalized. */
export function normalizeFreeText<T extends Record<string, unknown>>(payload: T): T {
  const out: Record<string, unknown> = { ...payload };
  for (const k of FREE_TEXT_FIELDS) {
    if (typeof out[k] === "string") out[k] = normalizeNewlines(out[k] as string);
  }
  return out as T;
}
