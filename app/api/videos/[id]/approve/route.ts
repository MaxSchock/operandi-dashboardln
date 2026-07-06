import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";

/**
 * POST /api/videos/:id/approve — final client approval of a delivered video.
 * Nothing is ever published without this (same gate philosophy as posts).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.status !== "delivered") {
    return NextResponse.json({ error: `cannot approve from status ${request.status}` }, { status: 409 });
  }

  const svc = serviceRoleClient();
  await svc.from("video_requests")
    .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", request.id).eq("status", "delivered");
  await addEvent(request.id, "video_approved", actor);

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
