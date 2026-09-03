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
  // The status was read a moment ago; if it moved in between, the update matches nothing
  // and Supabase still returns error=null. Approving a video that stayed unapproved is
  // exactly the kind of silent success this codebase keeps producing (Codex, 2026-09-03).
  const upd = await svc.from("video_requests")
    .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", request.id).eq("status", "delivered").select("id");
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data?.length) {
    return NextResponse.json({ error: "the video changed status while you were approving it" }, { status: 409 });
  }
  await addEvent(request.id, "video_approved", actor);

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
