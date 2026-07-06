import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";

/**
 * POST /api/videos/:id/regen — start a paid regeneration: a child request
 * (regen_of = parent) born at storyboard_ready with the parent's storyboard
 * plus the client's notes. The regen credit is only consumed when the client
 * approves the child's storyboard (same choke point as any render).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["delivered", "approved", "published"].includes(request.status)) {
    return NextResponse.json({ error: `cannot regenerate from status ${request.status}` }, { status: 409 });
  }
  if (request.regen_of) {
    return NextResponse.json({ error: "this is already a regeneration; regenerate from the original video" }, { status: 409 });
  }

  const svc = serviceRoleClient();
  // The credit itself is enforced in video_consume_credit; this is an early,
  // friendlier check so the client does not draft a doomed regen.
  const { count } = await svc.from("video_requests")
    .select("id", { count: "exact", head: true })
    .eq("regen_of", request.id).eq("consumed_credit", true);
  if ((count ?? 0) >= actor.features.video_regens_per_video) {
    return NextResponse.json({ error: "This video already used its 1 paid regeneration." }, { status: 403 });
  }

  let notes = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) notes = String((await req.json()).notes ?? "");
  else notes = String((await req.formData()).get("notes") ?? "");
  notes = notes.trim();
  if (!notes) return NextResponse.json({ error: "describe what should change in the new version" }, { status: 400 });

  const { data, error: dbError } = await svc.from("video_requests").insert({
    client_slug: request.client_slug,
    content_slug: request.content_slug,
    status: "storyboard_ready",
    brief: { ...request.brief, regen_notes: notes },
    duration_s: request.duration_s,
    recipe: request.recipe,
    storyboard: request.storyboard,
    storyboard_notes: notes,
    regen_of: request.id,
    cost_estimated_usd: request.cost_estimated_usd,
    created_by: actor.tier.userId,
  }).select("id").single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addEvent(request.id, "regen_started", actor, { child: data.id, notes });
  await addEvent(data.id, "created", actor, { regen_of: request.id });

  if (ct.includes("application/json")) return NextResponse.json({ id: data.id });
  return NextResponse.redirect(new URL(`/videos/${data.id}`, req.url), 303);
}
