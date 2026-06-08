"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { clsx } from "clsx";
import { Calendar } from "lucide-react";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/date-range";

export function DateRangePicker({ defaultKey = "14d" as RangeKey }: { defaultKey?: RangeKey }) {
  const router = useRouter();
  const sp = useSearchParams();
  const pathname = usePathname();
  const current = (sp.get("range") as RangeKey | null) ?? defaultKey;

  const [customSince, setCustomSince] = useState(sp.get("since") ?? "");
  const [customUntil, setCustomUntil] = useState(sp.get("until") ?? "");

  function setRange(key: RangeKey, extra?: Record<string, string>) {
    const p = new URLSearchParams(sp.toString());
    p.set("range", key);
    p.delete("since"); p.delete("until");
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    router.push(`${pathname}?${p.toString()}`);
  }

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customSince || !customUntil) return;
    setRange("custom", { since: customSince, until: customUntil });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-lg border bg-white p-1 text-xs">
        <Calendar className="ml-1 h-3.5 w-3.5 text-slate-400" />
        {RANGE_OPTIONS.map(o => (
          <button
            key={o.key}
            onClick={() => setRange(o.key)}
            className={clsx(
              "rounded-md px-2.5 py-1 transition-colors",
              current === o.key
                ? "bg-electric text-white"
                : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <form onSubmit={applyCustom} className="inline-flex items-center gap-1 rounded-lg border bg-white p-1 text-xs">
        <input
          type="date"
          value={customSince}
          onChange={e => setCustomSince(e.target.value)}
          className="rounded-md border-0 px-1.5 py-0.5 text-xs focus:outline-none"
        />
        <span className="text-slate-400">→</span>
        <input
          type="date"
          value={customUntil}
          onChange={e => setCustomUntil(e.target.value)}
          className="rounded-md border-0 px-1.5 py-0.5 text-xs focus:outline-none"
        />
        <button
          type="submit"
          className={clsx(
            "rounded-md px-2 py-1 text-xs",
            current === "custom" ? "bg-electric text-white" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          Apply
        </button>
      </form>
    </div>
  );
}
