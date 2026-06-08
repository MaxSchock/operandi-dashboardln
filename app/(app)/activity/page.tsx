import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";

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

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string; channel?: string }> }) {
  const params = await searchParams;
  const typeFilter = params.type ?? "all";
  const channelFilter = params.channel ?? "all";

  const sb = await createClient();
  let qb = sb.from("lead_events").select("*").order("occurred_at", { ascending: false }).limit(150);
  if (typeFilter !== "all") qb = qb.eq("event_type", typeFilter);
  if (channelFilter !== "all") qb = qb.eq("channel", channelFilter);

  const { data } = await qb;
  const rows = (data ?? []) as EventRow[];

  const allTypes = Array.from(new Set(rows.map(r => r.event_type))).sort();
  const allChannels = Array.from(new Set(rows.map(r => r.channel))).sort();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Activity</h1>
        <p className="text-sm text-slate-500">All inbound + outbound events across your leads.</p>
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
            <EmptyState title="Nothing logged yet" hint="Events show up as soon as Unipile starts pushing webhooks." />
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
