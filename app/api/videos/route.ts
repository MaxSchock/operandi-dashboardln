import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, addEvent, estimateCostUsd } from "@/lib/videos";

const STYLES = new Set(["typography", "broll", "talking_head"]);
const LANGS = new Set(["en", "de", "fr", "nl", "es"]);

/**
 * POST /api/videos — create a video request from the wizard.
 * Validates the brief server-side (duration, mandatory fields, voice consent)
 * and inserts it as storyboard_pending; the video-engine picks it up and
 * writes the storyboard. No cost is incurred until the client approves the
 * storyboard (approve-storyboard route → video_consume_credit()).
 */
export async function POST(req: NextRequest) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  let body: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) body = await req.json();
  else {
    const fd = await req.formData();
    body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  }

  const goal = String(body.goal ?? "").trim();
  const keyMessage = String(body.key_message ?? "").trim();
  const cta = String(body.cta ?? "").trim();
  const style = String(body.style ?? "").trim();
  const language = String(body.language ?? "").trim();
  const visualDirections = String(body.visual_directions ?? "").trim();
  const linkedPostId = String(body.linked_post_id ?? "").trim();
  const durationS = Number(body.duration_s ?? 0);
  const voice = body.voice === true || body.voice === "true" || body.voice === "on";

  if (!goal || !keyMessage || !cta) {
    return NextResponse.json({ error: "goal, key_message and cta are required" }, { status: 400 });
  }
  if (!STYLES.has(style)) return NextResponse.json({ error: "invalid style" }, { status: 400 });
  if (!LANGS.has(language)) return NextResponse.json({ error: "invalid language" }, { status: 400 });
  if (!Number.isInteger(durationS) || durationS < 3 || durationS > actor.features.video_max_duration_s) {
    return NextResponse.json(
      { error: `duration must be 3-${actor.features.video_max_duration_s} seconds` },
      { status: 400 },
    );
  }
  if (voice && !actor.features.voice_consent_at) {
    return NextResponse.json({ error: "voice cloning requires recorded consent" }, { status: 403 });
  }

  const svc = serviceRoleClient();
  const { data, error: dbError } = await svc.from("video_requests").insert({
    client_slug: actor.clientSlug,
    content_slug: actor.contentSlug,
    status: "storyboard_pending",
    brief: {
      goal, key_message: keyMessage, cta, style, language,
      visual_directions: visualDirections, linked_post_id: linkedPostId || null, voice,
    },
    duration_s: durationS,
    cost_estimated_usd: estimateCostUsd(style, durationS, voice),
    created_by: actor.tier.userId,
  }).select("id").single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addEvent(data.id, "created", actor, { style, duration_s: durationS, voice });

  if (ct.includes("application/json")) return NextResponse.json({ id: data.id });
  return NextResponse.redirect(new URL(`/videos/${data.id}`, req.url), 303);
}
