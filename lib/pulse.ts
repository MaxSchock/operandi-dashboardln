import { createClient, createPublicClient } from "@/lib/supabase/server";

/** What tells that a table has news: its row count, the newest value of each
 * `stamps` column and, for short tables whose rows change state without a
 * timestamp, the states themselves. */
type Watch = { table: string; stamps: string[]; state?: string; pub?: boolean };

const LEAD_STATE: Watch = { table: "lead_state", stamps: ["updated_at"] };
const LEAD_EVENTS: Watch = { table: "lead_events", stamps: ["ingested_at"] };

/** The tables each screen draws from. Content and a video's own page are not
 * here: they keep themselves up to date (GET /api/content, /api/videos/:id/...). */
const SCREENS: [RegExp, Watch[]][] = [
  [/^\/dashboard$/, [LEAD_STATE, LEAD_EVENTS,
    { table: "content_calendar", stamps: ["published_at"] },
    { table: "weekly_narratives", stamps: ["generated_at"] }]],
  [/^\/leads(\/|$)/, [LEAD_STATE, LEAD_EVENTS,
    { table: "lead_actions", stamps: ["created_at", "executed_at"] }]],
  [/^\/activity$/, [LEAD_EVENTS]],
  [/^\/calling(\/|$)/, [LEAD_STATE, LEAD_EVENTS,
    { table: "email_messages", stamps: ["updated_at"] },
    { table: "email_sequences", stamps: ["updated_at"] },
    { table: "calling_config", stamps: ["updated_at"] }]],
  [/^\/engagement$/, [{ table: "dm_proposals", stamps: ["created_at", "approved_at", "sent_at"], state: "status" }]],
  [/^\/distribution$/, [
    { table: "content_group_queue", stamps: ["created_at", "approved_at", "sent_at"], state: "status" },
    { table: "content_groups", stamps: ["last_seen_at", "curated_at"], state: "status" }]],
  [/^\/templates(\/|$)/, [{ table: "templates_approved", stamps: ["approved_at"], state: "stage" }]],
  [/^\/videos$/, [{ table: "video_requests", stamps: ["updated_at"], pub: true }]],
  [/^\/admin$/, [LEAD_STATE]],
  [/^\/admin\/health$/, [LEAD_EVENTS, { table: "lead_actions", stamps: ["created_at", "executed_at"] },
    { table: "bandit_arms", stamps: ["last_updated"] }]],
  [/^\/admin\/bandit$/, [{ table: "bandit_arms", stamps: ["last_updated"] }]],
];

export const watched = (path: string) => SCREENS.find(([re]) => re.test(path))?.[1] ?? null;

/** A short mark of what the signed-in user can see of a screen's tables (RLS
 * applies). The layout asks for it now and then and draws the screen again
 * only when it differs from the last one, instead of on a timer. */
export async function pulse(path: string): Promise<string | null> {
  const list = watched(path);
  if (!list) return null;
  const [own, pub] = await Promise.all([createClient(), createPublicClient()]);
  const parts = await Promise.all(list.map(async w => {
    const sb = w.pub ? pub : own;
    const asks: PromiseLike<string>[] = [
      sb.from(w.table).select("*", { count: "exact", head: true })
        .then((r: { count: number | null; error: unknown }) => r.error ? "x" : String(r.count ?? 0)),
      ...w.stamps.map(c =>
        sb.from(w.table).select(c).not(c, "is", null).order(c, { ascending: false }).limit(1)
          .then((r: { data: unknown; error: unknown }) => r.error ? "x" : String((r.data as Record<string, unknown>[] | null)?.[0]?.[c] ?? ""))),
    ];
    if (w.state) {
      const c = w.state;
      asks.push(sb.from(w.table).select(c).limit(5000)
        .then((r: { data: unknown; error: unknown }) => {
          if (r.error) return "x";
          const n: Record<string, number> = {};
          for (const row of (r.data as Record<string, unknown>[] | null) ?? []) { const k = String(row[c]); n[k] = (n[k] ?? 0) + 1; }
          return Object.keys(n).sort().map(k => `${k}:${n[k]}`).join(",");
        }));
    }
    return (await Promise.all(asks)).join("~");
  }));
  return parts.join("|");
}
