import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Building2, Briefcase, Activity as ActivityIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = Number(id);
  if (Number.isNaN(leadId)) notFound();

  const sb = await createClient();
  const [{ data: lead }, { data: state }, { data: events }, { data: actions }] = await Promise.all([
    sb.from("leads").select("*").eq("id", leadId).maybeSingle(),
    sb.from("lead_state").select("*").eq("lead_id", leadId).maybeSingle(),
    sb.from("lead_events").select("*").eq("lead_id", leadId).order("occurred_at", { ascending: false }).limit(50),
    sb.from("lead_actions").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(10),
  ]);

  if (!lead) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/leads" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3 w-3" /> Back to leads
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy">{lead.full_name ?? "Lead"}</h1>
          <p className="mt-1 text-sm text-slate-500">{lead.headline ?? ""}</p>
        </div>
        {state && <StageBadge stage={state.current_stage} large />}
      </header>

      <section className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader title="Identity" />
          <CardBody className="space-y-2 text-sm">
            <Row icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={lead.company ?? "—"} />
            <Row icon={<Briefcase className="h-3.5 w-3.5" />} label="Role" value={lead.role ?? "—"} />
            <Row icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={lead.email ?? "—"} />
            <Row icon={<ActivityIcon className="h-3.5 w-3.5" />} label="Source" value={lead.source ?? "—"} />
            {lead.icp_segment && (
              <div className="pt-2"><Badge tone="electric">{lead.icp_segment}</Badge></div>
            )}
          </CardBody>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader title="Channel state" hint="What the system knows about each channel" />
          <CardBody>
            {state && Object.keys(state.channel_state ?? {}).length > 0 ? (
              <pre className="whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(state.channel_state, null, 2)}</pre>
            ) : (
              <EmptyState title="No channel state yet" hint="Will populate as soon as the first action runs." />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Timeline" hint="Most recent first" />
          <CardBody className="p-0">
            {(events ?? []).length === 0 ? (
              <EmptyState title="No events yet" />
            ) : (
              <ol className="divide-y">
                {(events ?? []).map(e => (
                  <li key={e.id} className="flex gap-4 px-5 py-3 text-sm">
                    <div className="w-40 shrink-0 text-xs text-slate-500">{new Date(e.occurred_at).toLocaleString()}</div>
                    <div>
                      <div className="font-medium text-slate-800">{e.event_type.replace("_", " ")}</div>
                      <div className="text-xs text-slate-500">{e.channel}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent actions" hint="What the decisor queued" />
          <CardBody className="p-0">
            {(actions ?? []).length === 0 ? (
              <EmptyState title="No actions yet" hint="The decisor will propose actions once autopilot tier ≥ 1." />
            ) : (
              <ol className="divide-y">
                {(actions ?? []).map(a => (
                  <li key={a.id} className="flex flex-col gap-1 px-5 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">{a.action_type}</span>
                      <Badge tone={a.status === "done" ? "green" : a.status === "failed" ? "red" : "slate"}>{a.status}</Badge>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{new Date(a.created_at).toLocaleString()}</span>
                      <span>{a.policy_reason ?? ""}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-slate-400">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className="break-words text-slate-700">{value}</div>
      </div>
    </div>
  );
}

function StageBadge({ stage, large }: { stage: string; large?: boolean }) {
  const tone =
    stage === "qualified" ? "green" :
    stage === "replied"   ? "electric" :
    stage === "accepted"  ? "amber" :
    stage === "opted_out" ? "red" :
    stage === "expired"   ? "red" : "slate";
  return (
    <span className={
      "inline-flex items-center rounded-full px-3 py-1 font-medium " +
      (large ? "text-sm " : "text-xs ") +
      (tone === "green"    ? "bg-emerald-100 text-emerald-700" :
       tone === "electric" ? "bg-electric/10 text-electric"    :
       tone === "amber"    ? "bg-amber-100 text-amber-700"     :
       tone === "red"      ? "bg-red-100 text-red-700"         :
                             "bg-slate-100 text-slate-700")
    }>{stage.replace("_", " ")}</span>
  );
}
