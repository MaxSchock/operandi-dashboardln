import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent, heldFromClient, HELD_MESSAGE } from "@/lib/videos";
import {
  isStaged, boardOf, shotsInOrder, enqueue, cleanRegion, applyScriptEdits, cleanMontage,
  type Board, type Montage, type ShotEdit, type Take,
} from "@/lib/video-staged";

/**
 * POST /api/videos/:id/staged — every action of the step-by-step flow.
 * Paid actions (draw, film, captions, music) must carry `confirmed_usd`, the
 * price the person saw in the confirmation; it is checked against the engine's
 * price for that step, so nothing is charged from a stale page.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });
  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request || !isStaged(request)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (heldFromClient(request, actor)) return NextResponse.json({ error: HELD_MESSAGE }, { status: 409 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const svc = serviceRoleClient();
  const board = boardOf(request);
  const bad = (msg: string, code = 400) => NextResponse.json({ error: msg }, { status: code });
  const queued = (r: Awaited<ReturnType<typeof enqueue>>) =>
    r.ok ? NextResponse.json({ ok: true, job_id: r.job_id }) : bad(r.error ?? "refused", r.reason ? 409 : 500);
  const paid = (price: number) => {
    const seen = Number(body.confirmed_usd);
    return Number.isFinite(seen) && Math.abs(seen - price) < 0.011;
  };
  const STALE = "The price of this step changed. Reload the page and confirm again.";

  if (action === "script_start") {
    if (request.status !== "draft") return bad("already started", 409);
    return queued(await enqueue(svc, request, actor, "script_propose"));
  }
  if (!board) return bad("the shot table is not written yet", 409);
  const shot = (n: unknown) => board.shots.find(s => s.n === Number(n));
  // A job already on its way reads the row when it starts: nothing it will read may change under it.
  const working = async (kind: string, n?: number) => {
    let q = svc.from("video_jobs").select("id", { count: "exact", head: true })
      .eq("request_id", request.id).eq("kind", kind).in("status", ["queued", "running"]);
    if (n !== undefined) q = q.eq("shot_n", n);
    return ((await q).count ?? 0) > 0;
  };
  const BUSY = "This is being worked on right now. Wait until it is done; the page refreshes itself.";

  if (action === "script_save") {
    if (request.status !== "script_ready") return bad("the script is already approved", 409);
    if (await working("script_apply")) return bad(BUSY, 409);
    const rows = Array.isArray(body.shots) ? (body.shots as unknown[]).filter(x => x && typeof x === "object") as ShotEdit[] : [];
    const decisions = body.proposals && typeof body.proposals === "object" ? body.proposals as Record<string, string> : {};
    const edited = applyScriptEdits(board, rows, typeof body.end_text === "string" ? body.end_text : undefined, decisions);
    if (edited.error) return bad(edited.error);
    const upd = await svc.from("video_requests").update({ storyboard: edited.board, updated_at: new Date().toISOString() })
      .eq("id", request.id).eq("status", "script_ready").select("id");
    if (upd.error || !upd.data?.length) return bad(upd.error?.message ?? "the video changed, reload the page", 409);
    const approve = body.approve === true;
    await addEvent(request.id, approve ? "script_approve_requested" : "script_edited", actor);
    return queued(await enqueue(svc, { ...request, storyboard: edited.board as unknown as Record<string, unknown> }, actor,
      "script_apply", { params: { approve } }));
  }

  if (action === "draw") {
    const s = shot(body.shot);
    const role = body.role === "end" ? "end" : "start";
    if (!s) return bad("shot not found", 404);
    if (!paid(board.costs.image)) return bad(STALE, 409);
    const note = String(body.note ?? "").trim().slice(0, 600);
    const region = cleanRegion(body.region);
    const { count } = await svc.from("video_keyframes").select("id", { count: "exact", head: true })
      .eq("request_id", request.id).eq("shot_n", s.n).eq("role", role);
    // House rule: no picture is drawn again without saying what to change.
    if ((count ?? 0) > 0 && !note) return bad("say what should change in this picture");
    let change: string | null = null;
    if (note || region) {
      const cr = await svc.from("video_change_requests").insert({
        request_id: request.id, shot_n: s.n, target: role === "end" ? "end_image" : "start_image", region, note: note || null,
        actor: actor.tier.isAdmin ? "admin" : "client", created_by: actor.tier.userId }).select("id").single();
      if (cr.error) return bad(cr.error.message, 500);
      change = cr.data.id;
    }
    const base = Number(body.base_version);
    const res = await enqueue(svc, request, actor, "image_draw", { shot: s.n, role, estimate: board.costs.image, change,
      params: { note, region, ...(Number.isInteger(base) ? { base_version: base } : {}) } });
    if (!res.ok && change) await svc.from("video_change_requests").update({ status: "dismissed" }).eq("id", change);
    return queued(res);
  }

  if (action === "image_pick") {
    if (!["script_approved", "images_approved", "shots_ready", "delivered"].includes(request.status)) return bad("not available now", 409);
    const { data: kf } = await svc.from("video_keyframes").select("id, shot_n, role, status, storage_key")
      .eq("id", String(body.keyframe)).eq("request_id", request.id).maybeSingle();
    if (!kf || !kf.storage_key || kf.status === "failed") return bad("picture not found", 404);
    if (kf.status === "approved") return NextResponse.json({ ok: true });
    // A shot being filmed right now is filmed from the picture approved until now.
    if (await working("shot_film", kf.shot_n)) return bad("This shot is being filmed right now. Change its picture when the take is done.", 409);
    const now = new Date().toISOString();
    const off = await svc.from("video_keyframes").update({ status: "rejected", updated_at: now })
      .eq("request_id", request.id).eq("shot_n", kf.shot_n).eq("role", kf.role).eq("status", "approved").neq("id", kf.id);
    const on = off.error ? off : await svc.from("video_keyframes").update({ status: "approved", updated_at: now }).eq("id", kf.id);
    if (on.error) return bad(on.error.message, 500);
    // A take filmed from another picture no longer shows what was approved.
    const stale = await svc.from("video_shot_takes").update({ status: "stale", updated_at: now })
      .eq("request_id", request.id).eq("shot_n", kf.shot_n).in("status", ["proposed", "approved"]).select("id");
    if (stale.data?.length && ["shots_ready", "delivered"].includes(request.status)) {
      await svc.from("video_requests").update({ status: "images_approved", updated_at: now }).eq("id", request.id).eq("status", request.status);
    }
    await addEvent(request.id, "keyframe_approved", actor, { shot: kf.shot_n, role: kf.role, takes_stale: stale.data?.length ?? 0 });
    return NextResponse.json({ ok: true });
  }

  if (action === "images_approve") {
    if (request.status !== "script_approved") return bad("not available now", 409);
    const { data: rows } = await svc.from("video_keyframes").select("shot_n, role").eq("request_id", request.id).eq("status", "approved");
    const have = new Set((rows ?? []).map((k: { shot_n: number; role: string }) => `${k.shot_n}:${k.role}`));
    const missing = (board.needs ?? []).filter(x => !have.has(`${x.n}:${x.role}`));
    if (missing.length) return bad(`approve these pictures first: ${missing.map(x => `shot ${x.n} (${x.role === "start" ? "first" : "last"})`).join(", ")}`);
    const upd = await svc.from("video_requests").update({ status: "images_approved", updated_at: new Date().toISOString() })
      .eq("id", request.id).eq("status", "script_approved").select("id");
    if (!upd.data?.length) return bad("the video changed, reload the page", 409);
    await addEvent(request.id, "images_approved", actor);
    return NextResponse.json({ ok: true });
  }

  if (action === "film") {
    const s = shot(body.shot);
    if (!s) return bad("shot not found", 404);
    const c = board.costs.shots[String(s.n)] ?? { film: 0, lips: 0, voice: 0 };
    const onlyLips = body.what === "lips";
    const price = Math.round((onlyLips ? c.lips : c.film + c.lips + c.voice) * 100) / 100;
    if (!paid(price)) return bad(STALE, 409);
    const note = String(body.note ?? "").trim().slice(0, 600);
    const region = cleanRegion(body.region);
    const frame = Number(body.frame_s);
    if (onlyLips && !region) return bad("mark the face that speaks");
    const { count } = await svc.from("video_shot_takes").select("id", { count: "exact", head: true })
      .eq("request_id", request.id).eq("shot_n", s.n);
    if ((count ?? 0) > 0 && !onlyLips && !note) return bad("say what should change in this shot");
    let change: string | null = null;
    if (note || region) {
      const cr = await svc.from("video_change_requests").insert({
        request_id: request.id, shot_n: s.n, target: "shot", region, note: note || null,
        frame_s: Number.isFinite(frame) ? frame : null,
        actor: actor.tier.isAdmin ? "admin" : "client", created_by: actor.tier.userId }).select("id").single();
      if (cr.error) return bad(cr.error.message, 500);
      change = cr.data.id;
    }
    const res = await enqueue(svc, request, actor, "shot_film", { shot: s.n, estimate: price, change,
      params: { note, region, ...(onlyLips ? { what: "lips" } : {}) } });
    if (!res.ok && change) await svc.from("video_change_requests").update({ status: "dismissed" }).eq("id", change);
    return queued(res);
  }

  if (action === "take_pick") {
    if (!["images_approved", "shots_ready", "delivered"].includes(request.status)) return bad("not available now", 409);
    const { data: take } = await svc.from("video_shot_takes").select("id, shot_n, status, lips")
      .eq("id", String(body.take)).eq("request_id", request.id).maybeSingle();
    const t = take as Pick<Take, "id" | "shot_n" | "status" | "lips"> | null;
    if (!t || t.status === "failed" || t.status === "stale") return bad("take not found", 404);
    const now = new Date().toISOString();
    const off = await svc.from("video_shot_takes").update({ status: "rejected", updated_at: now })
      .eq("request_id", request.id).eq("shot_n", t.shot_n).eq("status", "approved").neq("id", t.id);
    // One approved take per shot is a unique index: of two clicks at once, one loses here.
    const on = off.error ? off : await svc.from("video_shot_takes").update({ status: "approved", updated_at: now })
      .eq("id", t.id).in("status", ["proposed", "rejected", "approved"]);
    if (on.error) return bad("Another take of this shot was approved at the same moment. Reload the page.", 409);
    const { data: ok } = await svc.from("video_shot_takes").select("shot_n").eq("request_id", request.id).eq("status", "approved");
    const done = new Set((ok ?? []).map((x: { shot_n: number }) => x.shot_n));
    if (request.status === "images_approved" && shotsInOrder(board).every(s => done.has(s.n))) {
      await svc.from("video_requests").update({ status: "shots_ready", updated_at: now }).eq("id", request.id).eq("status", "images_approved");
    }
    await addEvent(request.id, "take_approved", actor, { shot: t.shot_n });
    return NextResponse.json({ ok: true });
  }

  if (action === "montage_save" || action === "assemble") {
    if (!["shots_ready", "delivered"].includes(request.status)) return bad("not available now", 409);
    if (await working("assemble")) return bad(BUSY, 409);
    const old = (request.montage ?? {}) as Montage;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.montage && typeof body.montage === "object") patch.montage = cleanMontage(old, body.montage as Record<string, unknown>);
    if (typeof body.end_text === "string") {
      patch.storyboard = { ...board, end_card: { ...board.end_card, text: body.end_text.trim().slice(0, 300) || null } } as Board;
    }
    const upd = await svc.from("video_requests").update(patch).eq("id", request.id).eq("status", request.status).select("id");
    if (upd.error || !upd.data?.length) return bad(upd.error?.message ?? "the video changed, reload the page", 409);
    if (action === "montage_save") return NextResponse.json({ ok: true });
    return queued(await enqueue(svc, request, actor, "assemble"));
  }

  if (action === "captions") {
    if (!paid(board.costs.captions)) return bad(STALE, 409);
    return queued(await enqueue(svc, request, actor, "captions_stt", { estimate: board.costs.captions }));
  }
  if (action === "music") {
    if (!paid(board.costs.music)) return bad(STALE, 409);
    const prompt = String(body.prompt ?? "").trim().slice(0, 400);
    return queued(await enqueue(svc, request, actor, "music", { estimate: board.costs.music, params: prompt ? { prompt } : {} }));
  }
  return bad("unknown action");
}
