/**
 * Date-range helper shared by every page that reads ?range= / ?since= / ?until=
 *
 * Preset values: 7d, 14d, 30d, 90d, all, custom (uses since+until).
 * Default: 14d (matches the original Overview window).
 */

export type RangeKey = "7d" | "14d" | "30d" | "90d" | "all" | "custom";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d",  label: "7 days"  },
  { key: "14d", label: "14 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

export type ResolvedRange = {
  key: RangeKey;
  since: Date | null;   // null when "all"
  until: Date;
  prevSince: Date | null;
  prevUntil: Date | null;
  /** Convenient ISO string for `gte.` filters. null when "all". */
  sinceIso: string | null;
  untilIso: string;
  label: string;
};

function startOfTodayUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysAgoUTC(n: number): Date {
  const d = startOfTodayUTC();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function resolveRange(
  params: { range?: string; since?: string; until?: string },
  fallback: RangeKey = "14d",
): ResolvedRange {
  const key = (params.range as RangeKey | undefined) ?? fallback;
  const until = new Date(); // now

  if (key === "custom") {
    const since = params.since ? new Date(params.since) : daysAgoUTC(13);
    const sinceUntilUntil = params.until ? new Date(params.until) : until;
    const windowDays = Math.max(1, Math.ceil((sinceUntilUntil.getTime() - since.getTime()) / 86400000));
    const prevUntil = new Date(since.getTime());
    const prevSince = new Date(since.getTime() - windowDays * 86400000);
    return {
      key,
      since,
      until: sinceUntilUntil,
      prevSince,
      prevUntil,
      sinceIso: since.toISOString(),
      untilIso: sinceUntilUntil.toISOString(),
      label: `${since.toISOString().slice(0, 10)} → ${sinceUntilUntil.toISOString().slice(0, 10)}`,
    };
  }

  if (key === "all") {
    return {
      key, since: null, until,
      prevSince: null, prevUntil: null,
      sinceIso: null, untilIso: until.toISOString(),
      label: "All time",
    };
  }

  const days = key === "7d" ? 7 : key === "30d" ? 30 : key === "90d" ? 90 : 14;
  const since = daysAgoUTC(days - 1);
  const prevUntil = new Date(since.getTime());
  const prevSince = daysAgoUTC(days * 2 - 1);

  return {
    key,
    since,
    until,
    prevSince,
    prevUntil,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    label: RANGE_OPTIONS.find(o => o.key === key)?.label ?? `${days} days`,
  };
}

/** Build a list of YYYY-MM-DD strings between since and until (inclusive). */
export function dayBuckets(since: Date, until: Date): string[] {
  const days: string[] = [];
  const cur = new Date(since);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(until);
  end.setUTCHours(0, 0, 0, 0);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}
