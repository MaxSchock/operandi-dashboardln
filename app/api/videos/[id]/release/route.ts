import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent, isHeld } from "@/lib/videos";
import { answer } from "@/lib/form-answer";

/**
 * POST /api/videos/:id/release — an admin lets a held video through to the
 * client. The engine's final check (video-engine app/review.py) put it on
 * hold; releasing says "I looked, it is fine" and keeps the findings on file.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });
  if (!actor.tier.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!isHeld(request)) return NextResponse.json({ error: "this video is not on hold" }, { status: 409 });

  const nowIso = new Date().toISOString();
  // Matched on the version as well: a newer delivery checked meanwhile keeps its own verdict.
  const upd = await serviceRoleClient().from("video_requests")
    .update({
      final_review: { ...request.final_review, state: "released", released_at: nowIso, released_by: actor.tier.userId },
      updated_at: nowIso,
    })
    .eq("id", request.id).eq("status", "delivered").eq("deliverable_version", request.deliverable_version)
    .eq("final_review->>state", "hold").select("id");
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data?.length) {
    return NextResponse.json({ error: "the video changed while you were releasing it" }, { status: 409 });
  }
  await addEvent(request.id, "final_review_released", actor, { version: request.deliverable_version });

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return answer(req, new URL(`/videos/${request.id}`, req.url));
}
