import { clsx } from "clsx";

export function KpiCard({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={clsx(
      "rounded-2xl border bg-white p-5 shadow-sm",
      accent && "border-electric/30",
    )}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx(
        "mt-1 font-display text-3xl",
        accent ? "text-electric" : "text-navy",
      )}>{value}</div>
    </div>
  );
}
