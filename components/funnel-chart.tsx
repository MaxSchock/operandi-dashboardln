"use client";

const STAGES = [
  { key: "pre_contact",  label: "Pre-contact",  color: "#94a3b8" },
  { key: "engaged_post", label: "Engaged",      color: "#a78bfa" },
  { key: "invited",      label: "Invited",      color: "#60a5fa" },
  { key: "accepted",     label: "Accepted",     color: "#1C68FA" },
  { key: "messaged",     label: "Messaged",     color: "#0ea5e9" },
  { key: "replied",      label: "Replied",      color: "#10b981" },
  { key: "qualified",    label: "Qualified",    color: "#059669" },
];

// `data` carries CUMULATIVE counts: how many leads ever reached each stage
// (a lead in `messaged` also counts towards accepted/invited). This keeps the
// funnel monotonic so conversion is always <=100%.
export function FunnelChart({ data }: { data: { stage: string; count: number }[] }) {
  const counts: Record<string, number> = {};
  for (const d of data) counts[d.stage] = d.count;
  const max = Math.max(1, ...STAGES.map(s => counts[s.key] ?? 0));

  return (
    <div className="space-y-2">
      {STAGES.map((s, i) => {
        const v = counts[s.key] ?? 0;
        const pct = (v / max) * 100;
        // Conversion vs the nearest upstream stage that actually has leads, so
        // an optional/skipped stage (e.g. Engaged, unused in cold-invite flows)
        // doesn't produce a misleading 0% or divide-by-zero.
        let previous: number | null = null;
        for (let j = i - 1; j >= 0; j--) {
          const pv = counts[STAGES[j].key] ?? 0;
          if (pv > 0) { previous = pv; break; }
        }
        const conv = previous && previous > 0 ? Math.round((v / previous) * 100) : null;
        return (
          <div key={s.key} className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3">
            <div className="text-xs text-slate-600">{s.label}</div>
            <div className="relative h-6 rounded-md bg-slate-100">
              <div
                className="absolute inset-y-0 left-0 rounded-md transition-all"
                style={{ width: `${pct}%`, backgroundColor: s.color }}
              />
              <div className="relative flex h-full items-center px-2 text-xs font-medium text-slate-700">
                {v}
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">{conv !== null ? `${conv}%` : "—"}</div>
          </div>
        );
      })}
      <div className="grid grid-cols-[7rem_1fr_4rem] gap-3 pt-1 text-[10px] uppercase tracking-wide text-slate-400">
        <div>stage</div>
        <div>count</div>
        <div className="text-right">conv. from prev.</div>
      </div>
    </div>
  );
}
