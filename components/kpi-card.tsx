import { Card, StatDelta } from "@/components/ui";
import { clsx } from "clsx";

export function KpiCard({
  label,
  value,
  delta,
  accent,
  hint,
}: {
  label: string;
  value: number | string;
  delta?: number | null;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <Card className={clsx("p-5", accent && "ring-1 ring-electric/30")}>
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        {delta !== undefined && <StatDelta value={delta ?? null} />}
      </div>
      <div className={clsx("mt-1 font-display text-3xl", accent ? "text-electric" : "text-navy")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </Card>
  );
}
