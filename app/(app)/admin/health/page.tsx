import { headers } from "next/headers";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";

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

export default async function HealthPage() {
  const h = await fetchHealth();

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-2xl text-navy">System health</h1>
          <p className="text-sm text-slate-500">Generated {new Date(h.generated_at).toLocaleString()}</p>
        </div>
        <Badge tone={h.status === "ok" ? "green" : h.status === "degraded" ? "amber" : "red"}>{h.status}</Badge>
      </header>

      <Card>
        <CardHeader title="Diagnostics" />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(h.checks).map(([k, v]) => (
                <tr key={k} className="border-t">
                  <td className="w-1/3 px-5 py-3 font-medium text-slate-700">{k}</td>
                  <td className="px-5 py-3 text-slate-600">
                    <pre className="whitespace-pre-wrap text-xs">{typeof v === "object" ? JSON.stringify(v, null, 2) : String(v)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
