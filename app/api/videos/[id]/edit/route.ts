import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";

/**
 * POST /api/videos/:id/edit — free edit of a delivered video (typography,
 * music, subtitles, trims, shot order). Recomposition only: no new footage is
 * generated, so it never consumes the regeneration credit.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.status !== "delivered") {
    return NextResponse.json({ error: `cannot edit from status ${request.status}` }, { status: 409 });
  }

  let notes = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) notes = String((await req.json()).notes ?? "");
  else notes = String((await req.formData()).get("notes") ?? "");
  notes = notes.trim();
  if (!notes) return NextResponse.json({ error: "describe the changes you want" }, { status: 400 });

  const svc = serviceRoleClient();
  await svc.from("video_requests")
    .update({ status: "edit_requested", updated_at: new Date().toISOString() })
    .eq("id", request.id).eq("status", "delivered");
  await addEvent(request.id, "edit_requested", actor, { notes });

  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
