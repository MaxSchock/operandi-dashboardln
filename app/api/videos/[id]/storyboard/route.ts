import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";

/**
 * POST /api/videos/:id/storyboard — request changes to a storyboard (free,
 * unlimited). Sends the request back to the engine with the client's notes.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.status !== "storyboard_ready") {
    return NextResponse.json({ error: `cannot revise storyboard from status ${request.status}` }, { status: 409 });
  }

  let notes = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) notes = String((await req.json()).notes ?? "");
  else notes = String((await req.formData()).get("notes") ?? "");
  notes = notes.trim();
  if (!notes) return NextResponse.json({ error: "notes are required" }, { status: 400 });

  const svc = serviceRoleClient();
  await svc.from("video_requests")
    .update({ storyboard_notes: notes, status: "storyboard_pending", updated_at: new Date().toISOString() })
    .eq("id", request.id).eq("status", "storyboard_ready");
  await addEvent(request.id, "storyboard_changes_requested", actor, { notes });

  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
