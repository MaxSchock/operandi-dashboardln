import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { DateRangePicker } from "@/components/date-range-picker";
import { resolveRange } from "@/lib/date-range";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EventRow = {
  id: number;
  lead_id: number;
  channel: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown> | null;
};

const EVENT_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  invite_sent: "amber",
  invite_accepted: "green",
  post_commented: "electric",
  message_in: "electric",
  message_out: "amber",
  email_sent: "amber",
  email_opened: "slate",
  email_replied: "green",
  email_bounced: "red",
  opt_out: "red",
};

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const tier = await getTier();
  if (!tier.hasOutreach) redirect("/dashboard");

  const params = await searchParams;
  const typeFilter = params.type ?? "all";
  const channelFilter = params.channel ?? "all";
  const range = resolveRange(params, "14d");

  const sb = await createClient();
  const scope = await getClientScope();
  let qb = sb.from("lead_events").select("*").order("occurred_at", { ascending: false }).limit(300);
  if (scope) qb = qb.eq("client_slug", scope);
  if (typeFilter !== "all") qb = qb.eq("event_type", typeFilter);
  if (channelFilter !== "all") qb = qb.eq("channel", channelFilter);
  if (range.sinceIso) qb = qb.gte("occurred_at", range.sinceIso);
  qb = qb.lte("occurred_at", range.untilIso);

  const { data } = await qb;
  const rows = (data ?? []) as EventRow[];

  const allTypes = Array.from(new Set(rows.map(r => r.event_type))).sort();
  const allChannels = Array.from(new Set(rows.map(r => r.channel))).sort();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">Activity</h1>
          <p className="text-sm text-slate-500">{rows.length} events · {range.label.toLowerCase()}</p>
        </div>
        <Suspense><DateRangePicker /></Suspense>
      </header>

      <Card>
        <CardHeader title="Filters" />
        <CardBody>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_5rem]">
            <select name="type" defaultValue={typeFilter} className="rounded-md border px-3 py-2 text-sm">
              <option value="all">All event types</option>
              {allTypes.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
            <select name="channel" defaultValue={channelFilter} className="rounded-md border px-3 py-2 text-sm">
              <option value="all">All channels</option>
              {allChannels.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="submit" className="rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:opacity-90">
              Apply
            </button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <EmptyState title="Nothing in this window" hint="Widen the date range or wait for Unipile webhooks." />
          ) : (
            <ol className="divide-y">
              {rows.map(e => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="w-44 shrink-0 text-xs text-slate-500">{new Date(e.occurred_at).toLocaleString()}</div>
                  <Badge tone={EVENT_TONE[e.event_type] ?? "slate"}>{e.event_type.replace("_", " ")}</Badge>
                  <Badge tone="slate">{e.channel}</Badge>
                  <Link href={`/leads/${e.lead_id}`} className="ml-auto text-xs text-electric hover:underline">
                    Lead #{e.lead_id} →
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
