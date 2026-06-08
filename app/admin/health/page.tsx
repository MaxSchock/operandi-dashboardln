import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Health = {
  status: "ok" | "degraded" | "down";
  generated_at: string;
  checks: Record<string, unknown>;
};

async function fetchHealth(): Promise<Health> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const res = await fetch(`${proto}://${host}/api/health`, { cache: "no-store" });
  return res.json();
}

function StatusPill({ status }: { status: Health["status"] }) {
  const styles: Record<Health["status"], string> = {
    ok: "bg-emerald-100 text-emerald-700",
    degraded: "bg-amber-100 text-amber-700",
    down: "bg-red-100 text-red-700",
  };
  return <span className={`rounded-full px-3 py-1 text-sm font-medium ${styles[status]}`}>{status}</span>;
}

export default async function HealthPage() {
  const h = await fetchHealth();
  const entries = Object.entries(h.checks);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-3xl text-navy">System health</h1>
        <StatusPill status={h.status} />
      </header>
      <p className="text-xs text-slate-400">Generated {new Date(h.generated_at).toLocaleString()}</p>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <table className="w-full text-sm">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="border-b last:border-b-0">
                <td className="py-2 pr-4 font-medium text-slate-700 align-top w-1/3">{k}</td>
                <td className="py-2 text-slate-600 align-top">
                  <pre className="whitespace-pre-wrap text-xs">{typeof v === "object" ? JSON.stringify(v, null, 2) : String(v)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
