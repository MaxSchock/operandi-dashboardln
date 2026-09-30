import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";
import { strategist } from "@/lib/calling-server";

export const dynamic = "force-dynamic";

type Filters = { titles: string[]; locations: string[]; keywords: string[]; industries: string[]; size_min: number; size_max: number };
type Person = { id: string; first_name: string | null; last_name: string | null; title: string | null; company: string | null; has_email: boolean; has_phone: boolean; already: boolean };
type Budget = { cap: number; spent: number; left: number };
type Saved = { name: string; filters: Filters };

const list = (v: string | undefined) => (v ?? "").split(",").map(x => x.trim()).filter(Boolean);
const join = (v: string[] | undefined) => (v ?? []).join(", ");
const qs = (f: Filters, extra: Record<string, string> = {}) => new URLSearchParams({
  titles: join(f.titles), locations: join(f.locations), keywords: join(f.keywords), industries: join(f.industries),
  size_min: String(f.size_min), size_max: String(f.size_max), ...extra,
}).toString();

async function call<T>(path: string, json?: unknown): Promise<T | { ok: false; reason: string }> {
  const res = await strategist(path, { json });
  try { return JSON.parse(res.text) as T; } catch { return { ok: false, reason: res.text.slice(0, 160) || `strategist ${res.status}` }; }
}

/** Find people in Apollo for the calling queue. Searching is free; adding reveals the
 *  picked people and spends one Apollo credit each, within the client's monthly cap. */
export default async function FindInApollo({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const tier = await getTier();
  if (!tier.isAdmin) redirect("/calling");
  const params = await searchParams;
  const client = params.client ?? (await getClientScope()) ?? "";
  if (!client || client === "all") redirect("/calling");
  const slug = encodeURIComponent(client);

  const sb = await createClient();
  const { data: cfg } = await sb.from("calling_config").select("apollo_saved_searches").eq("client_slug", client).maybeSingle();
  const saved = ((cfg?.apollo_saved_searches ?? []) as Saved[]);

  const hasFilters = ["titles", "keywords", "industries"].some(k => params[k] !== undefined);
  let filters: Filters;
  let budget: Budget | null = null;
  if (hasFilters) {
    filters = {
      titles: list(params.titles), locations: list(params.locations), keywords: list(params.keywords),
      industries: list(params.industries), size_min: Number(params.size_min) || 5, size_max: Number(params.size_max) || 20,
    };
  } else {
    const d = await call<{ filters: Filters; budget: Budget }>(`/outreach/calling/${slug}/apollo/defaults`);
    filters = "filters" in d ? d.filters : { titles: [], locations: [], keywords: [], industries: [], size_min: 5, size_max: 20 };
    budget = "budget" in d ? d.budget : null;
  }
  const page = Math.max(1, Number(params.page) || 1);
  let result: { ok: true; total: number; people: Person[]; budget: Budget } | { ok: false; reason: string } | null = null;
  if (params.run === "1") {
    const r = await call<{ ok: true; total: number; people: Person[]; budget: Budget }>(
      `/outreach/calling/${slug}/apollo/preview`, { filters, page });
    result = r;
    if (r.ok) budget = r.budget;
  }
  const input = "w-full rounded-md border px-3 py-2 text-sm";
  const notice = params.notice;

  return (
    <div className="space-y-6">
      <header>
        <a href={`/calling?client=${slug}&tab=to_call`} className="text-xs text-slate-500 hover:text-slate-700">← Calling</a>
        <h1 className="font-display text-2xl text-navy">Find people in Apollo · {client}</h1>
        <p className="text-sm text-slate-500">
          Searching is free. Adding reveals the people you tick and costs one Apollo credit each.
          {budget && <> This month: {Math.round(budget.spent)} of {budget.cap} credits used, <b>{Math.floor(budget.left)} left</b>.</>}
        </p>
      </header>
      {notice && <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800">{notice}</div>}

      <Card>
        <CardHeader title="Search" hint="Comma separated. Trades are keywords, not industries." />
        <CardBody>
          {saved.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Saved:</span>
              {saved.map(s => (
                <a key={s.name} href={`/calling/find?${qs(s.filters, { client, run: "1" })}`}
                  className="rounded-full border px-2 py-0.5 text-electric hover:bg-electric/5">{s.name}</a>
              ))}
            </div>
          )}
          <form action="/calling/find" method="get" className="grid gap-4 text-sm md:grid-cols-2">
            <input type="hidden" name="client" value={client} />
            <input type="hidden" name="run" value="1" />
            <label>Job titles<input name="titles" defaultValue={join(filters.titles)} className={input} placeholder="Owner, Director, Founder" /></label>
            <label>Locations<input name="locations" defaultValue={join(filters.locations)} className={input} placeholder="Manchester, United Kingdom" /></label>
            <label>Company keywords<input name="keywords" defaultValue={join(filters.keywords)} className={input} placeholder="plumbing, heating" /></label>
            <label>Industries (optional)<input name="industries" defaultValue={join(filters.industries)} className={input} placeholder="construction" /></label>
            <div className="flex items-end gap-3">
              <label className="w-24">Size from<input type="number" name="size_min" min={1} defaultValue={filters.size_min} className={input} /></label>
              <label className="w-24">to<input type="number" name="size_max" min={1} defaultValue={filters.size_max} className={input} /></label>
              <span className="pb-2 text-xs text-slate-500">people</span>
            </div>
            <div className="flex items-end">
              <button className="rounded-md bg-electric px-4 py-2 text-sm font-medium text-white hover:opacity-90">Search (free)</button>
            </div>
          </form>
          {hasFilters && (
            <form action={`/api/calling/apollo/save?client=${slug}`} method="post" className="mt-4 flex items-center gap-2 text-xs">
              <input type="hidden" name="filters" value={JSON.stringify(filters)} />
              <input name="name" required maxLength={40} placeholder="name this search" className="rounded-md border px-2 py-1" />
              <button className="rounded-md border px-2 py-1 text-slate-700 hover:bg-slate-50">Save search</button>
            </form>
          )}
        </CardBody>
      </Card>

      {result && !result.ok && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">Search failed: {result.reason}</div>
      )}
      {result && result.ok && (
        <Card>
          <CardHeader title={`${result.total ?? 0} people match`} hint={`Page ${page}. Ticked: has a phone and is not in your list yet.`} />
          <CardBody>
            <form action={`/api/calling/apollo/add?client=${slug}`} method="post">
              <input type="hidden" name="filters" value={JSON.stringify(filters)} />
              <input type="hidden" name="back" value={`/calling/find?${qs(filters, { client, run: "1", page: String(page) })}`} />
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400"><tr><th className="w-8" /><th>Name</th><th>Title</th><th>Company</th><th /></tr></thead>
                <tbody>
                  {result.people.map(p => (
                    <tr key={p.id} className="border-t">
                      <td className="py-1.5"><input type="checkbox" name="id" value={p.id} disabled={p.already} defaultChecked={p.has_phone && !p.already} /></td>
                      <td>{p.first_name} {p.last_name}</td>
                      <td className="text-slate-600">{p.title}</td>
                      <td className="text-slate-600">{p.company}</td>
                      <td className="space-x-1 text-right">
                        {p.already && <Badge tone="slate">already in</Badge>}
                        {!p.has_phone && <Badge tone="amber">no phone</Badge>}
                        {p.has_email && <Badge tone="slate">email</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button className="rounded-md bg-electric px-4 py-2 text-sm font-medium text-white hover:opacity-90">Add ticked to To call</button>
                <span className="text-xs text-slate-500">One credit per person; people without a phone after revealing are not added.</span>
                <span className="ml-auto flex gap-3 text-xs">
                  {page > 1 && <a className="text-electric hover:underline" href={`/calling/find?${qs(filters, { client, run: "1", page: String(page - 1) })}`}>← previous</a>}
                  {result.people.length === 25 && <a className="text-electric hover:underline" href={`/calling/find?${qs(filters, { client, run: "1", page: String(page + 1) })}`}>next →</a>}
                </span>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
