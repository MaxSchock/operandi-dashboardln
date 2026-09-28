import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";
import { MAX_SCENE_REDOS, sceneRedoCostUsd, type RedoWhat } from "@/lib/video-dialogue";

const WHAT = new Set<RedoWhat>(["image", "motion", "voice"]);

/**
 * POST /api/videos/:id/redo — make one scene of a delivered dialogue video
 * again (new image, new movement, or new voice) and reuse every other scene.
 * Paid: it counts against the client's monthly budget, never against the
 * weekly slot, and at most MAX_SCENE_REDOS times per video.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.brief?.style !== "dialogue") {
    return NextResponse.json({ error: "only dialogue videos can redo a single scene" }, { status: 400 });
  }
  if (request.status !== "delivered") {
    return NextResponse.json({ error: `cannot redo a scene from status ${request.status}` }, { status: 409 });
  }

  const ct = req.headers.get("content-type") ?? "";
  const body = ct.includes("application/json")
    ? await req.json()
    : Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  const shot = Number(body.shot);
  const what = String(body.what) as RedoWhat;
  const notes = String(body.notes ?? "").trim().slice(0, 500);
  const shots = ((request.storyboard?.shots as { n?: number; kind?: string }[] | undefined) ?? []);
  const scene = shots.find(s => Number(s.n) === shot);
  if (!scene) return NextResponse.json({ error: "that scene does not exist" }, { status: 400 });
  if (!WHAT.has(what)) return NextResponse.json({ error: "choose what to redo" }, { status: 400 });
  if (what === "image" && scene.kind === "pantalla") {
    return NextResponse.json({ error: "a scene with your app has no drawn image; redo its movement instead" }, { status: 400 });
  }

  const svc = serviceRoleClient();
  const { count } = await svc.from("video_events").select("id", { count: "exact", head: true })
    .eq("request_id", request.id).eq("event_type", "shot_redo_requested");
  if ((count ?? 0) >= MAX_SCENE_REDOS) {
    return NextResponse.json({ error: `this video already used its ${MAX_SCENE_REDOS} scene redos` }, { status: 409 });
  }
  const estimate = sceneRedoCostUsd(scene.kind ?? "persona", what);
  const { data: spend } = await svc.rpc("video_spend_status", { p_request: request.id });
  const s = (spend ?? {}) as { spent_usd?: number; cap_usd?: number; this_request_usd?: number };
  if (s.cap_usd && Number(s.spent_usd ?? 0) + Number(s.this_request_usd ?? 0) + estimate > Number(s.cap_usd)) {
    return NextResponse.json({ error: "The monthly production budget for your account is used up. Ask Max if you need more." }, { status: 402 });
  }

  // The event first: the engine reads the latest one when it picks the job up.
  await addEvent(request.id, "shot_redo_requested", actor, { shot, what, notes, estimated_usd: estimate });
  const upd = await svc.from("video_requests")
    .update({ status: "redo_requested", error: null, updated_at: new Date().toISOString() })
    .eq("id", request.id).eq("status", "delivered").select("id");
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data?.length) {
    return NextResponse.json({ error: "the video changed status while you were writing" }, { status: 409 });
  }

  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
