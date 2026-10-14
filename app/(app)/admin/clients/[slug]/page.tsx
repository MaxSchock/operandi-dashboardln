import { createClient, serviceRoleClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { ActionForm } from "@/components/action-form";

export const dynamic = "force-dynamic";

export default async function AdminClientDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createClient();

  const [{ data: arms }, { data: actions }, { data: caps }] = await Promise.all([
    sb.from("bandit_arms").select("*").eq("client_slug", slug).order("dimension").order("key"),
    sb.from("lead_actions").select("id, action_type, status, scheduled_for, policy_reason, created_at").eq("client_slug", slug).order("created_at", { ascending: false }).limit(50),
    serviceRoleClient().schema("outreach").from("client_features").select("video_enabled, video_request_cap_usd, video_token_cap_usd")
      .eq("client_slug", slug).maybeSingle(),
  ]);
  const cap = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-navy">{slug}</h1>
          <p className="text-sm text-slate-500">Client overrides — operandi_admin only.</p>
        </div>
        <div className="flex gap-2">
          <ActionForm action={`/api/admin/override/pause-autopilot?slug=${slug}`} done="Autopilot paused.">
            <button className="rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200">Pause autopilot</button>
          </ActionForm>
          <ActionForm action={`/api/admin/override/force-topup?slug=${slug}`} working="Asking for a top-up..." done="Top-up started.">
            <button className="rounded-md bg-electric/10 px-3 py-1.5 text-xs font-medium text-electric hover:bg-electric/20">Force Apollo top-up</button>
          </ActionForm>
        </div>
      </header>

      {caps && (
        <Card>
          <CardHeader title="Video spending caps per request" hint={caps.video_enabled ? undefined : "Video is off for this client."} />
          <CardBody>
            <ActionForm action={`/api/admin/override/video-caps?slug=${slug}`} working="Saving..." done="Caps saved." said={{ video_caps_saved: "Caps saved." }} testid="video-caps">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-slate-600">Providers per video, USD (video_request_cap_usd)
                  <input name="video_request_cap_usd" inputMode="decimal" defaultValue={cap(caps.video_request_cap_usd)} placeholder="default"
                    className="mt-1 w-full rounded-md border bg-white px-2 py-1 text-sm" />
                </label>
                <label className="block text-xs text-slate-600">Model tokens per video, USD (video_token_cap_usd)
                  <input name="video_token_cap_usd" inputMode="decimal" defaultValue={cap(caps.video_token_cap_usd)} placeholder="default"
                    className="mt-1 w-full rounded-md border bg-white px-2 py-1 text-sm" />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Empty: the default, 3 $ or the estimate the client approved plus 15 %, whichever is higher (tokens: 3 $).
                0: no cap for this client. A step that would go over the cap is not run, and the job shows why.
              </p>
              <button className="mt-2 rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white">Save caps</button>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Bandit arms" />
        <CardBody>
          {(arms ?? []).length === 0 ? (
            <EmptyState title="No arms for this client" />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {(arms ?? []).map(a => (
                <li key={a.id} className="flex items-center justify-between border-b py-2 last:border-b-0">
                  <span><strong className="text-slate-800">{a.dimension}</strong> <span className="text-slate-500">/ {a.key}</span></span>
                  <span className="flex items-center gap-3 text-xs text-slate-500">
                    α={Number(a.alpha).toFixed(2)} · β={Number(a.beta).toFixed(2)} · obs={a.observations}
                    {!a.active && <Badge tone="red">frozen</Badge>}
                    <ActionForm action={`/api/admin/override/freeze-arm?id=${a.id}`} done="Frozen.">
                      <button className="text-[11px] text-red-600 hover:underline">freeze</button>
                    </ActionForm>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Last 50 actions" />
        <CardBody className="p-0 overflow-x-auto">
          {(actions ?? []).length === 0 ? (
            <EmptyState title="No actions yet" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-3 py-3">Action</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(actions ?? []).map(a => (
                  <tr key={a.id} className="border-t">
                    <td className="px-5 py-2.5 text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-700">{a.action_type}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={a.status === "done" ? "green" : a.status === "failed" ? "red" : "slate"}>{a.status}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{a.policy_reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
