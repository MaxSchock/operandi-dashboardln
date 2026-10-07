import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest } from "@/lib/videos";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/:id/status — a short mark of where the request stands (its
 * state, version, images and events). The detail page asks for it while the
 * video is being made and draws itself again only when the mark changes.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });
  const { id } = await ctx.params;
  const r = await loadOwnedRequest(id, actor);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const svc = serviceRoleClient();
  const [kf, ev] = await Promise.all([
    svc.from("video_keyframes").select("id", { count: "exact", head: true }).eq("request_id", id),
    svc.from("video_events").select("id", { count: "exact", head: true }).eq("request_id", id),
  ]);
  const row = r as unknown as { status: string; deliverable_version?: number | null; error?: string | null; final_review?: { state?: string } | null };
  const mark = [row.status, row.deliverable_version ?? 0, row.error ? 1 : 0, row.final_review?.state ?? "", kf.count ?? 0, ev.count ?? 0].join("|");
  return NextResponse.json({ status: row.status, mark }, { headers: { "cache-control": "no-store" } });
}
