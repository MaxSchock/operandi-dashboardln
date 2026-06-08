import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

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
  const { data } = await sb.from("templates_approved").select("*").order("client_slug").order("stage");
  const rows = (data ?? []) as TemplateRow[];

  const byClient: Record<string, TemplateRow[]> = {};
  for (const r of rows) {
    (byClient[r.client_slug] ??= []).push(r);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Templates</h1>
        <p className="text-sm text-slate-500">Approved bodies the decisor can pick from. Variants live in <code>meta.variants</code>.</p>
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
                return (
                  <div key={t.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone="slate">{t.channel}</Badge>
                      <Badge tone="electric">{t.stage}</Badge>
                      <Badge tone="slate">{t.language}</Badge>
                      {t.arm_key && <Badge tone="amber">{t.arm_key}</Badge>}
                      {!t.active && <Badge tone="red">inactive</Badge>}
                      {t.approved_by === "claude-needs-max-review" && <Badge tone="amber">needs review</Badge>}
                      <span className="ml-auto text-[11px] text-slate-400">{new Date(t.approved_at).toLocaleDateString()}</span>
                    </div>
                    {t.body && (
                      <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">{t.body}</pre>
                    )}
                    {variants && variants.length > 0 && (
                      <div className="mt-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-400">Variants ({variants.length})</div>
                        <ul className="mt-1 space-y-1 text-xs text-slate-600">
                          {variants.map((v, i) => <li key={i}>• {v}</li>)}
                        </ul>
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
