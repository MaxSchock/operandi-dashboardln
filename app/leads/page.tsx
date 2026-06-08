import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const sb = await createClient();
  const { data: leads } = await sb
    .from("leads")
    .select("id, full_name, headline, company, email")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="font-display text-3xl text-navy">Leads</h1>
      <div className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Headline</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Email</th>
            </tr>
          </thead>
          <tbody>
            {(leads ?? []).map(l => (
              <tr key={l.id} className="border-t">
                <td className="px-4 py-3">
                  <Link href={`/leads/${l.id}`} className="text-electric hover:underline">{l.full_name ?? "—"}</Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{l.headline ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{l.company ?? "—"}</td>
                <td className="px-4 py-3 text-slate-400">{l.email ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
