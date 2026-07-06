import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { DateRangePicker } from "@/components/date-range-picker";
import { resolveRange } from "@/lib/date-range";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";
import { LockedPanel } from "@/components/locked-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LeadInfo = {
  id: number;
  full_name: string | null;
  headline: string | null;
  company: string | null;
  email: string | null;
  source: string | null;
  icp_segment: string | null;
};

type LeadJoinRow = {
  lead_id: number;
  client_slug: string;
  current_stage: string;
  updated_at: string;
  // Supabase typed-join returns the related rows as an array even when it's 1:1.
  leads: LeadInfo[] | LeadInfo | null;
};

function lead(row: LeadJoinRow): LeadInfo | null {
  if (!row.leads) return null;
  return Array.isArray(row.leads) ? (row.leads[0] ?? null) : row.leads;
}

const STAGES = ["all", "pre_contact", "engaged_post", "invited", "accepted", "messaged", "replied", "qualified", "opted_out", "expired", "paused"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const tier = await getTier();
  if (!tier.hasOutreach) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl text-navy">Leads</h1>
        </header>
        <LockedPanel feature="leads" />
      </div>
    );
  }

  const params = await searchParams;
  const stage = params.stage ?? "all";
  const q = (params.q ?? "").trim();
  const source = params.source ?? "all";
  const scope = await getClientScope();
  // URL param wins over global scope so admins can drill in from a list view.
  const client = params.client ?? (scope ?? "all");
  const range = resolveRange(params, "30d");

  const sb = await createClient();
  let qb = sb
    .from("lead_state")
    .select("lead_id, client_slug, current_stage, updated_at, leads!inner(id, full_name, headline, company, email, source, icp_segment)")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (stage !== "all") qb = qb.eq("current_stage", stage);
  if (client !== "all") qb = qb.eq("client_slug", client);
  if (range.sinceIso) qb = qb.gte("updated_at", range.sinceIso);
  qb = qb.lte("updated_at", range.untilIso);

  const { data } = await qb;
  let rows = (data ?? []) as LeadJoinRow[];

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(r => {
      const li = lead(r);
      return (
        (li?.full_name ?? "").toLowerCase().includes(needle) ||
        (li?.company ?? "").toLowerCase().includes(needle) ||
        (li?.email ?? "").toLowerCase().includes(needle)
      );
    });
  }
  if (source !== "all") rows = rows.filter(r => lead(r)?.source === source);

  const sources = Array.from(new Set(rows.map(r => lead(r)?.source).filter(Boolean))) as string[];
  const clients = Array.from(new Set(rows.map(r => r.client_slug).filter(Boolean))).sort();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">Leads</h1>
          <p className="text-sm text-slate-500">{rows.length} shown · updated within {range.label.toLowerCase()}</p>
        </div>
        <Suspense><DateRangePicker defaultKey="30d" /></Suspense>
      </header>

      <Card>
        <CardHeader title="Filters" />
        <CardBody>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_9rem_9rem_9rem_5rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Search name, company or email"
                className="w-full rounded-md border pl-9 pr-3 py-2 text-sm"
              />
            </div>
            <select name="client" defaultValue={client} className="rounded-md border px-3 py-2 text-sm">
              <option value="all">All clients</option>
              {clients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select name="stage" defaultValue={stage} className="rounded-md border px-3 py-2 text-sm">
              {STAGES.map(s => <option key={s} value={s}>{s === "all" ? "All stages" : s.replace("_", " ")}</option>)}
            </select>
            <select name="source" defaultValue={source} className="rounded-md border px-3 py-2 text-sm">
              <option value="all">All sources</option>
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" className="rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:opacity-90">
              Apply
            </button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0 overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState title="No leads match" hint="Adjust filters or wait for the next Apollo top-up." />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Headline</th>
                  <th className="px-5 py-3">Company</th>
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3">Segment</th>
                  <th className="px-5 py-3">Stage</th>
                  <th className="px-5 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const li = lead(r);
                  return (
                    <tr key={r.lead_id} className="border-t hover:bg-slate-50">
                      <td className="px-5 py-2.5"><Badge tone="slate">{r.client_slug}</Badge></td>
                      <td className="px-5 py-2.5">
                        <Link href={`/leads/${r.lead_id}`} className="font-medium text-navy hover:underline">
                          {li?.full_name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-5 py-2.5 text-slate-600">{li?.headline ?? "—"}</td>
                      <td className="px-5 py-2.5 text-slate-600">{li?.company ?? "—"}</td>
                      <td className="px-5 py-2.5 text-slate-500 text-xs">{li?.source ?? "—"}</td>
                      <td className="px-5 py-2.5 text-slate-500 text-xs">{li?.icp_segment ?? "—"}</td>
                      <td className="px-5 py-2.5"><StageBadge stage={r.current_stage} /></td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">{new Date(r.updated_at).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const tone =
    stage === "qualified" ? "green" :
    stage === "replied"   ? "electric" :
    stage === "accepted"  ? "amber" :
    stage === "opted_out" ? "red" :
    stage === "expired"   ? "red" : "slate";
  return <Badge tone={tone as "slate" | "green" | "amber" | "red" | "electric"}>{stage.replace("_", " ")}</Badge>;
}
