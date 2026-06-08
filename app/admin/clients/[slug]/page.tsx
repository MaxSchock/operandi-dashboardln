import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminClientDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createClient();

  const [{ data: arms }, { data: lastActions }] = await Promise.all([
    sb.from("bandit_arms").select("*").eq("client_slug", slug),
    sb.from("lead_actions").select("id, action_type, status, scheduled_for, policy_reason, created_at")
      .eq("client_slug", slug).order("created_at", { ascending: false }).limit(50),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-3xl text-navy">{slug}</h1>
        <div className="flex gap-2">
          <form action={`/api/admin/override/pause-autopilot?slug=${slug}`} method="post">
            <button className="rounded-md bg-red-100 px-3 py-1.5 text-sm text-red-700 hover:bg-red-200">Pause autopilot</button>
          </form>
          <form action={`/api/admin/override/force-topup?slug=${slug}`} method="post">
            <button className="rounded-md bg-electric/10 px-3 py-1.5 text-sm text-electric hover:bg-electric/20">Force Apollo topup</button>
          </form>
        </div>
      </header>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-display text-xl text-navy">Bandit arms</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {(arms ?? []).map(a => (
            <li key={a.id} className="flex items-center justify-between border-b py-2">
              <span><strong>{a.dimension}</strong> / {a.key}</span>
              <span className="text-slate-500">
                α={Number(a.alpha).toFixed(2)} β={Number(a.beta).toFixed(2)} obs={a.observations}
                <form className="ml-3 inline" action={`/api/admin/override/freeze-arm?id=${a.id}`} method="post">
                  <button className="text-xs text-red-600 hover:underline">freeze</button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-display text-xl text-navy">Last 50 actions</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Created</th>
              <th className="px-2 py-2">Action</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(lastActions ?? []).map(a => (
              <tr key={a.id} className="border-t">
                <td className="px-2 py-2 text-slate-500">{new Date(a.created_at).toLocaleString()}</td>
                <td className="px-2 py-2 text-slate-700">{a.action_type}</td>
                <td className="px-2 py-2">{a.status}</td>
                <td className="px-2 py-2 text-slate-500">{a.policy_reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
