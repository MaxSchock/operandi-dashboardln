import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminClientDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createClient();

  const [{ data: arms }, { data: actions }] = await Promise.all([
    sb.from("bandit_arms").select("*").eq("client_slug", slug).order("dimension").order("key"),
    sb.from("lead_actions").select("id, action_type, status, scheduled_for, policy_reason, created_at").eq("client_slug", slug).order("created_at", { ascending: false }).limit(50),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">{slug}</h1>
          <p className="text-sm text-slate-500">Client overrides — operandi_admin only.</p>
        </div>
        <div className="flex gap-2">
          <form action={`/api/admin/override/pause-autopilot?slug=${slug}`} method="post">
            <button className="rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200">Pause autopilot</button>
          </form>
          <form action={`/api/admin/override/force-topup?slug=${slug}`} method="post">
            <button className="rounded-md bg-electric/10 px-3 py-1.5 text-xs font-medium text-electric hover:bg-electric/20">Force Apollo top-up</button>
          </form>
        </div>
      </header>

      <Card>
        <CardHeader title="Bandit arms" />
        <CardBody>
          {(arms ?? []).length === 0 ? (
            <EmptyState title="No arms for this client" />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {(arms ?? []).map(a => (
                <li key={a.id} className="flex items-center justify-between border-b py-2 last:border-b-0">
                  <span><strong className="text-slate-800">{a.dimension}</strong> <span className="text-slate-500">/ {a.key}</span></span>
                  <span className="flex items-center gap-3 text-xs text-slate-500">
                    α={Number(a.alpha).toFixed(2)} · β={Number(a.beta).toFixed(2)} · obs={a.observations}
                    {!a.active && <Badge tone="red">frozen</Badge>}
                    <form action={`/api/admin/override/freeze-arm?id=${a.id}`} method="post">
                      <button className="text-[11px] text-red-600 hover:underline">freeze</button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Last 50 actions" />
        <CardBody className="p-0 overflow-x-auto">
          {(actions ?? []).length === 0 ? (
            <EmptyState title="No actions yet" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-3 py-3">Action</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(actions ?? []).map(a => (
                  <tr key={a.id} className="border-t">
                    <td className="px-5 py-2.5 text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-700">{a.action_type}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={a.status === "done" ? "green" : a.status === "failed" ? "red" : "slate"}>{a.status}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{a.policy_reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
