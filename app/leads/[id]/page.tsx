import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const leadId = Number(id);
  if (Number.isNaN(leadId)) notFound();

  const [{ data: lead }, { data: state }, { data: events }] = await Promise.all([
    sb.from("leads").select("*").eq("id", leadId).maybeSingle(),
    sb.from("lead_state").select("*").eq("lead_id", leadId).maybeSingle(),
    sb.from("lead_events").select("*").eq("lead_id", leadId).order("occurred_at", { ascending: false }).limit(50),
  ]);

  if (!lead) notFound();

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header>
        <h1 className="font-display text-3xl text-navy">{lead.full_name ?? "Lead"}</h1>
        <p className="text-sm text-slate-500">{lead.headline ?? ""} {lead.company ? `· ${lead.company}` : ""}</p>
      </header>

      {state && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Current stage</div>
          <div className="mt-1 font-display text-xl text-electric">{state.current_stage}</div>
          {state.last_touch_at && (
            <p className="mt-2 text-xs text-slate-400">Last touch: {new Date(state.last_touch_at).toLocaleString()}</p>
          )}
        </section>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg text-navy">Timeline</h2>
        <ol className="mt-4 space-y-3 text-sm">
          {(events ?? []).map(e => (
            <li key={e.id} className="flex gap-3 border-l-2 border-electric/40 pl-3">
              <div className="w-44 shrink-0 text-xs text-slate-500">{new Date(e.occurred_at).toLocaleString()}</div>
              <div>
                <div className="font-medium text-slate-800">{e.event_type}</div>
                <div className="text-xs text-slate-500">{e.channel}</div>
              </div>
            </li>
          ))}
          {(events ?? []).length === 0 && <li className="text-sm text-slate-400">No events yet.</li>}
        </ol>
      </section>
    </main>
  );
}
