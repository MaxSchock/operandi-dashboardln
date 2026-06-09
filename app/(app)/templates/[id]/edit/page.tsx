import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";
import { labelFor } from "@/lib/template-labels";

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

export default async function EditTemplate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tid = Number(id);
  if (Number.isNaN(tid)) notFound();

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: cu } = await sb.from("client_users").select("role").eq("user_id", user.id).maybeSingle();
  if (cu?.role !== "operandi_admin") redirect("/templates");

  const { data } = await sb.from("templates_approved").select("*").eq("id", tid).maybeSingle();
  if (!data) notFound();
  const t = data as TemplateRow;
  const variants = (t.meta?.variants as string[] | undefined) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/templates" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3 w-3" /> Back to templates
        </Link>
      </div>

      {(() => {
        const label = labelFor({ channel: t.channel, stage: t.stage, arm_key: t.arm_key });
        return (
          <header>
            <h1 className="font-display text-2xl text-navy">{label.title}</h1>
            <p className="mt-1 text-sm text-slate-500">{label.when}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="slate">{t.client_slug}</Badge>
              <Badge tone="slate">{label.channelLabel}</Badge>
              <Badge tone="slate">{t.language.toUpperCase()}</Badge>
              {!t.active && <Badge tone="red">inactive</Badge>}
              {t.approved_by === "claude-needs-max-review" && <Badge tone="amber">needs review</Badge>}
              <span className="text-[11px] text-slate-400">
                stage: {t.stage} · arm: {t.arm_key ?? "—"} · row #{t.id}
              </span>
            </div>
          </header>
        );
      })()}

      <Card>
        <CardHeader title="Body & variants" hint="Saving will mark you as the approver." />
        <CardBody>
          <form action={`/api/admin/template/${t.id}?action=save`} method="post" className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-700">Body</label>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Single body the decisor uses unless <code>Variants</code> below has rows. Supports
                <code className="ml-1">{`{{first_name}}`}</code> and <code>{`{{company}}`}</code> placeholders.
              </p>
              <textarea
                name="body"
                defaultValue={t.body}
                rows={12}
                className="mt-2 w-full rounded-md border bg-white px-3 py-2 font-mono text-xs leading-5"
                placeholder="Leave empty to use variants only"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Variants — one per line (optional)</label>
              <p className="mt-0.5 text-[11px] text-slate-500">
                When this is filled, the decisor picks one at random per send and ignores <code>Body</code>.
                Useful for the engage-post comment pool.
              </p>
              <textarea
                name="variants"
                defaultValue={variants.join("\n")}
                rows={6}
                className="mt-2 w-full rounded-md border bg-white px-3 py-2 font-mono text-xs leading-5"
                placeholder="Tout à fait, surtout dans les environnements orientés clients.&#10;C'est souvent sous-estimé en contexte professionnel.&#10;…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Arm key</label>
                <input
                  name="arm_key"
                  defaultValue={t.arm_key ?? ""}
                  placeholder="leave blank for stage-only template"
                  className="mt-2 w-full rounded-md border bg-white px-3 py-2 text-xs"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" name="active" defaultChecked={t.active} className="h-4 w-4" />
                  Active (decisor can pick this row)
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Link href="/templates" className="rounded-md border bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                Cancel
              </Link>
              <button type="submit" className="rounded-md bg-electric px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
                Save & approve
              </button>
            </div>
          </form>
        </CardBody>
      </Card>

      <p className="text-xs text-slate-400">
        Reference: <code>UPDATE outreach.templates_approved SET body=&apos;…&apos;, meta=… WHERE id={t.id};</code>
      </p>
    </div>
  );
}
