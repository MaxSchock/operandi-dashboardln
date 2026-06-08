import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

type ArmRow = {
  id: number;
  client_slug: string;
  dimension: string;
  key: string;
  alpha: number;
  beta: number;
  observations: number;
  active: boolean;
  freeze_reason: string | null;
  last_updated: string;
};

export default async function BanditHealth() {
  const sb = await createClient();
  const { data } = await sb.from("bandit_arms").select("*").order("client_slug").order("dimension").order("key");
  const arms = (data ?? []) as ArmRow[];

  const grouped: Record<string, ArmRow[]> = {};
  for (const a of arms) {
    grouped[`${a.client_slug} · ${a.dimension}`] ??= [];
    grouped[`${a.client_slug} · ${a.dimension}`].push(a);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Bandit health</h1>
        <p className="text-sm text-slate-500">Thompson-sampling posterior per (client, dimension, arm). Decay 90d, opt-out penalty 3x.</p>
      </header>

      {Object.keys(grouped).length === 0 ? (
        <Card><CardBody><EmptyState title="No bandit arms yet" /></CardBody></Card>
      ) : (
        Object.entries(grouped).map(([title, list]) => {
          const maxWin = Math.max(...list.map(a => a.alpha / Math.max(1, a.alpha + a.beta)));
          return (
            <Card key={title}>
              <CardHeader title={title} hint={`${list.length} arm${list.length === 1 ? "" : "s"}`} />
              <CardBody className="space-y-3">
                {list.map(a => {
                  const winrate = a.alpha / Math.max(1, a.alpha + a.beta);
                  const pct = winrate * 100;
                  const isBest = winrate === maxWin && a.observations > 0;
                  return (
                    <div key={a.id} className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-slate-800">{a.key}</span>
                        {!a.active && <Badge tone="red">frozen{a.freeze_reason ? `: ${a.freeze_reason}` : ""}</Badge>}
                        {isBest && a.active && <Badge tone="green">leader</Badge>}
                        <span className="ml-auto text-xs text-slate-500">
                          α={Number(a.alpha).toFixed(2)} · β={Number(a.beta).toFixed(2)} · obs={a.observations}
                        </span>
                      </div>
                      <div className="relative h-3 rounded-md bg-slate-100">
                        <div
                          className="absolute inset-y-0 left-0 rounded-md bg-electric transition-all"
                          style={{ width: `${pct}%`, opacity: a.active ? 1 : 0.3 }}
                        />
                      </div>
                      <div className="text-right text-[11px] text-slate-400">winrate ≈ {pct.toFixed(1)}%</div>
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
