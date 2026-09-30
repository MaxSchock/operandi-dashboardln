import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";
import { DEFAULT_CALL_HINT, type CallingConfig } from "@/lib/calling";

export const dynamic = "force-dynamic";

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;

/** Per-client calling setup. Operators edit what helps them on the phone (help text,
 *  objections, market note); the email engine's settings are for Operandi admins. */
export default async function CallingSettings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const tier = await getTier();
  if (!tier.hasLeads || !tier.canOperate) redirect("/calling");
  const params = await searchParams;
  const scope = await getClientScope();
  const client = tier.isAdmin ? (params.client ?? scope ?? "") : (tier.clientSlug ?? "");
  if (!client || client === "all") redirect("/calling");

  const sb = await createClient();
  const { data } = await sb.from("calling_config").select("*").eq("client_slug", client).maybeSingle();
  const c = (data ?? null) as CallingConfig | null;
  const saved = params.saved === "1";
  const err = params.error;
  const input = "w-full rounded-md border px-3 py-2 text-sm";
  const area = "w-full rounded-md border bg-slate-50 p-2 text-xs leading-5";

  return (
    <div className="space-y-6">
      <header>
        <a href={`/calling?client=${encodeURIComponent(client)}`} className="text-xs text-slate-500 hover:text-slate-700">← Calling</a>
        <h1 className="font-display text-2xl text-navy">Calling settings · {client}</h1>
        {!c && <p className="text-sm text-amber-700">No settings yet for this client: saving creates them. Until then the defaults apply.</p>}
      </header>
      {saved && <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Saved.</div>}
      {c?.mailbox_paused_at && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span>Follow-up emails are paused since {new Date(c.mailbox_paused_at).toLocaleString("en-GB")}: {c.mailbox_paused_reason ?? "too many bounces"}. Clean the list before resuming.</span>
          {tier.isAdmin && (
            <form action={`/api/calling/config?client=${encodeURIComponent(client)}&action=resume`} method="post" className="ml-auto">
              <button className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:opacity-90">Resume sending</button>
            </form>
          )}
        </div>
      )}
      {err && <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">Not saved: {err}</div>}

      <form action={`/api/calling/config?client=${encodeURIComponent(client)}`} method="post" className="space-y-6">
        <Card>
          <CardHeader title="On the phone" hint="Shown on every card while calling" />
          <CardBody className="space-y-4 text-sm">
            <label className="block">Notes hint
              <input name="call_hint" defaultValue={c?.call_hint ?? DEFAULT_CALL_HINT} className={input} />
            </label>
            <label className="block">Before you call (do-not-call lists, hours, anything this market needs)
              <textarea name="compliance_note" defaultValue={c?.compliance_note ?? ""} rows={2} className={area} />
            </label>
            <label className="block">Objections, one per line: <code>objection =&gt; answer</code>
              <textarea name="objections" rows={6} className={area}
                defaultValue={(c?.objections ?? []).map(o => `${o.objection} => ${o.answer}`).join("\n")} />
            </label>
          </CardBody>
        </Card>

        {tier.isAdmin && (
          <>
            <Card>
              <CardHeader title="Market" hint="Defaults for leads Apollo does not place; each lead can override on its card" />
              <CardBody className="grid gap-4 text-sm md:grid-cols-4">
                <label>Country<input name="default_country" defaultValue={c?.default_country ?? ""} placeholder="United Kingdom" className={input} /></label>
                <label>Time zone<input name="default_timezone" defaultValue={c?.default_timezone ?? ""} placeholder="Europe/London" className={input} /></label>
                <label>Email language<input name="default_language" defaultValue={c?.default_language ?? ""} placeholder="en-GB, es, de, fr, nl" className={input} /></label>
                <label>Default size filter
                  <select name="default_size" defaultValue={c?.default_size ?? "all"} className={input}>
                    {["all", "1-4", "5-20", "21-50", "51+", "unknown"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Follow-up emails" hint="Sent from the client's mailbox in each lead's own business hours" />
              <CardBody className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span>Days</span>
                  {DAYS.map(([n, label]) => (
                    <label key={n} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="send_days" value={n} defaultChecked={(c?.send_days ?? [1, 2, 3, 4]).includes(n)} />{label}
                    </label>
                  ))}
                  <label className="flex items-center gap-1 text-xs">from<input type="number" name="send_start_hour" min={0} max={23} defaultValue={c?.send_start_hour ?? 9} className="w-16 rounded border px-2 py-1" /></label>
                  <label className="flex items-center gap-1 text-xs">to<input type="number" name="send_end_hour" min={1} max={24} defaultValue={c?.send_end_hour ?? 17} className="w-16 rounded border px-2 py-1" /></label>
                  <label className="flex items-center gap-1 text-xs">emails<input type="number" name="total_steps" min={1} max={8} defaultValue={c?.total_steps ?? 4} className="w-16 rounded border px-2 py-1" /></label>
                  <label className="flex items-center gap-1 text-xs">days apart<input type="number" name="gap_days" min={1} max={60} defaultValue={c?.gap_days ?? 7} className="w-16 rounded border px-2 py-1" /></label>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="require_consent" defaultChecked={c?.require_consent ?? true} />
                  Only open a sequence when the caller ticked &quot;they said yes to an email&quot;
                </label>
                <div className="grid gap-4 md:grid-cols-3">
                  <label>Sender name<input name="sender_name" defaultValue={c?.sender_name ?? ""} className={input} /></label>
                  <label>Sender company<input name="sender_company" defaultValue={c?.sender_company ?? ""} className={input} /></label>
                  <label>Booking link<input name="booking_link" defaultValue={c?.booking_link ?? ""} className={input} /></label>
                </div>
                <label className="block">Signature<textarea name="signature" defaultValue={c?.signature ?? ""} rows={3} className={area} /></label>
                <label className="block">Opt-out line (in the default language; other languages get a built-in one)
                  <input name="opt_out_line" defaultValue={c?.opt_out_line ?? ""} className={input} /></label>
                <label className="block">Proof points, one per line (the only facts the emails may use)
                  <textarea name="proof_points" defaultValue={(c?.proof_points ?? []).join("\n")} rows={5} className={area} /></label>
                <label className="block">House rules, one per line
                  <textarea name="rules" defaultValue={(c?.rules ?? []).join("\n")} rows={4} className={area} /></label>
                <label className="block">Orange branches (JSON: key, label, one angle per email)
                  <textarea name="branches" rows={10} className={`${area} font-mono`}
                    defaultValue={JSON.stringify(c?.branches ?? [{ key: "generic", label: "Not clear yet", angles: [] }], null, 2)} /></label>
              </CardBody>
            </Card>
          </>
        )}
        <button className="rounded-md bg-electric px-4 py-2 text-sm font-medium text-white hover:opacity-90">Save</button>
      </form>
    </div>
  );
}
