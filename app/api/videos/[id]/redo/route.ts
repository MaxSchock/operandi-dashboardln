import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, heldFromClient, HELD_MESSAGE } from "@/lib/videos";
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
  if (heldFromClient(request, actor)) return NextResponse.json({ error: HELD_MESSAGE }, { status: 409 });
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

  // Limit, budget, event and status in one locked transaction: two clicks
  // cannot both pass, and the engine never reads an event that lost.
  const estimate = sceneRedoCostUsd(scene.kind ?? "persona", what);
  const { data, error: rpcError } = await serviceRoleClient().rpc("video_request_redo", {
    p_request: request.id, p_shot: shot, p_what: what, p_notes: notes, p_estimate: estimate,
    p_actor: actor.tier.isAdmin ? "admin" : "client", p_actor_id: actor.tier.userId, p_max: MAX_SCENE_REDOS,
  });
  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });
  const verdict = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!verdict.ok) {
    const msg: Record<string, [string, number]> = {
      status: ["the video changed status while you were writing", 409],
      redo_limit: [`this video already used its ${MAX_SCENE_REDOS} scene redos`, 409],
      monthly_cap_reached: ["The monthly production budget for your account is used up. Ask Max if you need more.", 402],
    };
    const [m, code] = msg[verdict.reason ?? ""] ?? ["not found", 404];
    return NextResponse.json({ error: m }, { status: code });
  }

  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/videos/${request.id}`, req.url), 303);
}
