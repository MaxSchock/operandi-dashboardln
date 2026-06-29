/* eslint-disable @next/next/no-img-element */
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { getClientScope } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CalendarRow = {
  post_id: string;
  client_slug: string;
  post_type: string | null;
  text_content: string | null;
  text_status: string | null;
  image_status: string | null;
  topic: string | null;
  pain_id: string | null;
  pain_label: string | null;
  image_url_imgbb: string | null;
  image_url_source: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  linkedin_url: string | null;
};

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  Published: "green",
  Approved: "electric",
  New: "slate",
  "Under review": "amber",
  "In progress": "amber",
  Suspended: "red",
};

export default async function ContentPage() {
  const sb = await createClient();
  const scope = await getClientScope();

  let q = sb
    .from("content_calendar")
    .select("*")
    .order("scheduled_for", { ascending: false })
    .limit(200);
  if (scope) q = q.eq("client_slug", scope);
  const { data } = await q;
  const rows = (data ?? []) as CalendarRow[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Content</h1>
        <p className="text-sm text-slate-500">
          The published and scheduled content calendar. Each post is themed on a pain point;
          engagement on it feeds the Warm DMs queue.
        </p>
      </header>

      <Card>
        <CardHeader title="Calendar" hint={`${rows.length} post${rows.length === 1 ? "" : "s"}`} />
        <CardBody className="space-y-4">
          {rows.length === 0 ? (
            <EmptyState title="No content yet" hint="Posts prepared by the content engine will show here." />
          ) : (
            rows.map(r => {
              const status = r.published_at ? "Published" : (r.text_status ?? "New");
              const img = r.image_url_imgbb || r.image_url_source;
              const when = r.published_at || r.scheduled_for;
              return (
                <div key={r.post_id} className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row">
                  {img ? (
                    <a href={img} target="_blank" rel="noreferrer" className="shrink-0">
                      <img
                        src={img}
                        alt="post"
                        className="h-32 w-32 rounded-md border object-cover"
                      />
                    </a>
                  ) : (
                    <div className="grid h-32 w-32 shrink-0 place-items-center rounded-md border border-dashed bg-slate-50 text-[10px] text-slate-400">
                      no image
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <Badge tone={STATUS_TONE[status] ?? "slate"}>{status}</Badge>
                      {r.pain_label && <Badge tone="electric">{r.pain_label.slice(0, 40)}</Badge>}
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400">
                        {when ? new Date(when).toLocaleString() : "—"}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-700">
                      {r.text_content ?? "(no text)"}
                    </p>
                    {r.linkedin_url && (
                      <a href={r.linkedin_url} target="_blank" rel="noreferrer"
                         className="mt-2 inline-block text-xs text-electric hover:underline">
                        View on LinkedIn ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>
    </div>
  );
}
