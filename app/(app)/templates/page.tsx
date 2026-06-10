import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";
import { labelFor } from "@/lib/template-labels";
import { getClientScope } from "@/lib/scope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TemplateRow = {
  id: number;
  client_slug: string;
  channel: string;
  stage: string;
  language: string;
  arm_key: string | null;
  body: string;
  meta: Record<string, unknown> | null;
  approved_by: string | null;
  approved_at: string;
  active: boolean;
};

export default async function TemplatesPage() {
  const sb = await createClient();
  const scope = await getClientScope();
  const { data: { user } } = await sb.auth.getUser();
  const tplQ = sb.from("templates_approved").select("*").order("client_slug").order("stage");
  const tplPromise = scope ? tplQ.eq("client_slug", scope) : tplQ;
  // Filter client_users by user_id — admins can see every row otherwise and
  // maybeSingle() bails (returns null), making isAdmin false on this page.
  const userInfoPromise = user
    ? sb.from("client_users").select("role").eq("user_id", user.id).maybeSingle()
    : Promise.resolve({ data: null });
  const [{ data }, { data: userInfo }] = await Promise.all([
    tplPromise,
    userInfoPromise,
  ]);
  const rows = (data ?? []) as TemplateRow[];
  const isAdmin = userInfo?.role === "operandi_admin";

  const byClient: Record<string, TemplateRow[]> = {};
  for (const r of rows) {
    (byClient[r.client_slug] ??= []).push(r);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Templates</h1>
        <p className="text-sm text-slate-500">
          Approved bodies the decisor can pick from. Variants live in <code>meta.variants</code>.
          {isAdmin && " · Click 'Approve as me' to clear the needs-review flag."}
        </p>
      </header>

      {Object.keys(byClient).length === 0 ? (
        <EmptyState title="No approved templates" />
      ) : (
        Object.entries(byClient).map(([slug, list]) => (
          <Card key={slug}>
            <CardHeader title={slug} hint={`${list.length} template${list.length === 1 ? "" : "s"}`} />
            <CardBody className="space-y-4">
              {list.map(t => {
                const variants = (t.meta?.variants as string[] | undefined) ?? null;
                const needsReview = t.approved_by === "claude-needs-max-review";
                const label = labelFor({ channel: t.channel, stage: t.stage, arm_key: t.arm_key });
                return (
                  <div key={t.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-display text-sm text-navy">{label.title}</div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{label.when}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <Badge tone="slate">{label.channelLabel}</Badge>
                        <Badge tone="slate">{t.language.toUpperCase()}</Badge>
                        {!t.active && <Badge tone="red">inactive</Badge>}
                        {needsReview && <Badge tone="amber">needs review</Badge>}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                      <span>stage: {t.stage}</span>
                      <span>·</span>
                      <span>arm: {t.arm_key ?? "—"}</span>
                      <span className="ml-auto normal-case tracking-normal text-slate-400">
                        approved by {t.approved_by ?? "—"} · {new Date(t.approved_at).toLocaleDateString()}
                      </span>
                    </div>
                    {t.body ? (
                      <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">{t.body}</pre>
                    ) : label.bodyMode === "intentionally_bare" ? (
                      <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs italic text-slate-500">
                        No text by design — LinkedIn receives an empty connection request.
                      </div>
                    ) : label.bodyMode === "variants_only" ? (
                      <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs italic text-slate-500">
                        No single body — the decisor picks one of the variants below at random.
                      </div>
                    ) : (
                      <div className="mt-3 rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-xs italic text-amber-700">
                        Body is empty — edit it before this template goes live.
                      </div>
                    )}
                    {variants && variants.length > 0 && (
                      <div className="mt-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-400">Variants ({variants.length})</div>
                        <ul className="mt-1 space-y-1 text-xs text-slate-600">
                          {variants.map((v, i) => <li key={i}>• {v}</li>)}
                        </ul>
                      </div>
                    )}

                    {isAdmin && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                        <Link
                          href={`/templates/${t.id}/edit`}
                          className="rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                        >
                          Edit body & variants
                        </Link>
                        {needsReview && (
                          <form action={`/api/admin/template/${t.id}?action=approve`} method="post">
                            <button className="rounded-md bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200">
                              Approve without changes
                            </button>
                          </form>
                        )}
                        {t.active ? (
                          <form action={`/api/admin/template/${t.id}?action=deactivate`} method="post">
                            <button className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
                              Deactivate
                            </button>
                          </form>
                        ) : (
                          <form action={`/api/admin/template/${t.id}?action=activate`} method="post">
                            <button className="rounded-md bg-electric/10 px-3 py-1 text-xs font-medium text-electric hover:bg-electric/20">
                              Activate
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
