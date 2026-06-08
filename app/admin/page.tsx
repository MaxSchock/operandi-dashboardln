import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const sb = await createClient();

  const [{ data: clients }, { data: arms }, { data: errors }] = await Promise.all([
    sb.from("lead_state").select("client_slug, current_stage"),
    sb.from("bandit_arms").select("client_slug, dimension, key, alpha, beta, observations, active"),
    // n8n_errors_inbox lives in public schema; tiny shim through service-role would be cleaner
    // for v1 we just render bandit + funnel summaries.
    Promise.resolve({ data: [] as any[] }),
  ]);

  // Aggregate funnel per client
  const byClient: Record<string, Record<string, number>> = {};
  for (const r of clients ?? []) {
    byClient[r.client_slug] = byClient[r.client_slug] ?? {};
    byClient[r.client_slug][r.current_stage] = (byClient[r.client_slug][r.current_stage] ?? 0) + 1;
  }

  return (
    <main className="mx-auto max-w-7xl p-6 space-y-8">
      <header>
        <h1 className="font-display text-3xl text-navy">Operandi · Admin</h1>
        <p className="text-sm text-slate-500">Cross-client view.</p>
      </header>

      <section className="rounded-2xl border bg-white p-5 shadow-sm overflow-x-auto">
        <h2 className="font-display text-xl text-navy">Funnel per client</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Pre-contact</th>
              <th className="px-3 py-2">Engaged</th>
              <th className="px-3 py-2">Invited</th>
              <th className="px-3 py-2">Accepted</th>
              <th className="px-3 py-2">Messaged</th>
              <th className="px-3 py-2">Replied</th>
              <th className="px-3 py-2">Qualified</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(byClient).map(([slug, counts]) => (
              <tr key={slug} className="border-t">
                <td className="px-3 py-2 font-medium text-navy">
                  <a className="hover:underline" href={`/admin/clients/${slug}`}>{slug}</a>
                </td>
                {["pre_contact","engaged_post","invited","accepted","messaged","replied","qualified"].map(s =>
                  <td key={s} className="px-3 py-2 text-slate-600">{counts[s] ?? 0}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm overflow-x-auto">
        <h2 className="font-display text-xl text-navy">Bandit health</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Dimension</th>
              <th className="px-3 py-2">Arm</th>
              <th className="px-3 py-2">Winrate</th>
              <th className="px-3 py-2">Obs</th>
              <th className="px-3 py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {(arms ?? []).map(a => {
              const winrate = a.alpha / Math.max(1, a.alpha + a.beta);
              return (
                <tr key={`${a.client_slug}-${a.dimension}-${a.key}`} className="border-t">
                  <td className="px-3 py-2 text-slate-700">{a.client_slug}</td>
                  <td className="px-3 py-2 text-slate-600">{a.dimension}</td>
                  <td className="px-3 py-2 text-slate-600">{a.key}</td>
                  <td className="px-3 py-2 font-medium text-electric">{(winrate * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-slate-600">{a.observations}</td>
                  <td className="px-3 py-2">
                    <span className={a.active ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                                                : "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"}>
                      {a.active ? "on" : "frozen"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
