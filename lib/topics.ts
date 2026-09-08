/**
 * Split the "Topics" textarea of the content generator into one briefing per post.
 *
 * It used to split on `/[\n,]/`, so a topic written as a real sentence was shredded at
 * its commas and each fragment became its own post. Gregor Kuhlmann typed
 * "1. Trust & Liability — warum wir bewusst auf Vertrauen und Haftung setzen statt nur
 * auf Features, weil am Ende jemand die Verantwortung tragen muss, dass es läuft."
 * and the engine generated three posts, one of them briefed as "muss dass es läuft."
 * (prepare run 2026-09-01 17:13). That is the "Wundertüte" he reported: nothing
 * downstream was broken, the briefing arrived already destroyed.
 *
 * Commas are never separators now. A blank line is one, when the text has any — that
 * lets a multi-line idea stay a single topic. With no blank line each line is a topic,
 * which is the one-per-line habit the form has always advertised.
 */
export function parseTopics(raw: string): string[] {
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const chunks = /\n\s*\n/.test(text) ? text.split(/\n\s*\n+/) : text.split("\n");
  return chunks
    .map(chunk =>
      chunk
        .split("\n")
        // Leading list markers ("1.", "-", "•") are numbering, not part of the briefing.
        .map(line => line.replace(/^\s*(?:\d+[.)]|[-*•–—])\s+/, "").trim())
        .filter(Boolean)
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}
