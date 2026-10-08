import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, addEvent, estimateCostUsd, MAX_REQUEST_CHARS, type VideoActor } from "@/lib/videos";
import { parseLines, dialogueSeconds, dialogueCostUsd, type DialogueLine } from "@/lib/video-dialogue";

const STYLES = new Set(["typography", "broll", "talking_head", "dialogue"]);
const LANGS = new Set(["en", "de", "fr", "nl", "es"]);
const ASPECTS = new Set(["9:16", "1:1", "16:9"]);
const HOOKS = new Set(["Bold claim", "Question", "Surprising stat", "Story opening"]);
const PILLARS = new Set(["Product", "Leadership", "AI at work", "Founder life", "Mindset", "Industry insight"]);
const CTA_STYLES = new Set(["Comment prompt", "Follow for more", "Link in comments"]);

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
  let durationS = Number(body.duration_s ?? 0);
  const voice = body.voice === true || body.voice === "true" || body.voice === "on";
  const aspect = ASPECTS.has(String(body.aspect)) ? String(body.aspect) : "9:16";
  const hookType = HOOKS.has(String(body.hook_type)) ? String(body.hook_type) : null;
  const topicPillar = PILLARS.has(String(body.topic_pillar)) ? String(body.topic_pillar) : null;
  const ctaStyle = CTA_STYLES.has(String(body.cta_style)) ? String(body.cta_style) : null;

  // One-field form: the client says what should happen and the engine's agent
  // picks style, length, message, CTA and lines (video-engine app/decide.py)
  // before the storyboard. Cost and final length are written by the engine.
  if (style === "auto") return createAuto(req, body, actor);
  if (style === "launch") return createLaunch(body, actor);

  if (!STYLES.has(style)) return NextResponse.json({ error: "invalid style" }, { status: 400 });
  // A dialogue video carries its message in the client's own lines: goal is
  // enough, and its length comes from the lines, not from a number typed in.
  let lines: DialogueLine[] = [];
  const endUrl = String(body.end_url ?? "").trim().slice(0, 80);
  if (style === "dialogue") {
    const parsed = parseLines(body.lines);
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
    lines = parsed.lines;
    durationS = dialogueSeconds(lines);
  }
  if (!goal || (style !== "dialogue" && (!keyMessage || !cta))) {
    return NextResponse.json({ error: "goal, key_message and cta are required" }, { status: 400 });
  }
  if (!LANGS.has(language)) return NextResponse.json({ error: "invalid language" }, { status: 400 });
  if (!Number.isInteger(durationS) || durationS < 3 || durationS > actor.features.video_max_duration_s) {
    return NextResponse.json(
      { error: style === "dialogue"
        ? `the lines add up to about ${durationS} seconds; your plan allows ${actor.features.video_max_duration_s}. Shorten or remove a line.`
        : `duration must be 3-${actor.features.video_max_duration_s} seconds` },
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
    // Draft until the browser has uploaded and confirmed the files (submit
    // route): the engine must not write a storyboard from half the material.
    status: "draft",
    brief: {
      goal, key_message: keyMessage, cta, style, language,
      visual_directions: visualDirections, linked_post_id: linkedPostId || null, voice,
      aspect: style === "dialogue" ? "9:16" : aspect, hook_type: hookType, topic_pillar: topicPillar, cta_style: ctaStyle,
      ...(style === "dialogue" ? {
        ...(actor.features.video_staged_flow ? { flow: "staged" } : {}),
        lines, end_url: endUrl || null, music: body.music !== false,
        // The engine converts a recording into a real person's voice only with
        // this: the consent recorded for the client, never a checkbox.
        voice_consent: !!actor.features.voice_consent_at,
      } : {}),
    },
    duration_s: durationS,
    cost_estimated_usd: style === "dialogue" ? dialogueCostUsd(lines) : estimateCostUsd(style, durationS, voice),
    created_by: actor.tier.userId,
  }).select("id").single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addEvent(data.id, "created", actor, { style, duration_s: durationS, voice, lines: lines.length || undefined });

  if (ct.includes("application/json")) return NextResponse.json({ id: data.id });
  return NextResponse.redirect(new URL(`/videos/${data.id}`, req.url), 303);
}



const TONES = new Set(["default", "polished", "yc-parody", "chaotic", "deadpan", "cinematic", "app-store"]);

/**
 * Product launch video: the engine opens the product's page and proposes
 * animated scenes from its own material (video-engine app/launch.py). Only
 * in the step-by-step flow: the scenes are rows of the script.
 */
async function createLaunch(body: Record<string, unknown>, actor: VideoActor) {
  if (!actor.features.video_staged_flow) {
    return NextResponse.json({ error: "product launch videos are not enabled for your account yet" }, { status: 403 });
  }
  const request = String(body.request ?? "").trim().slice(0, 400);
  const language = String(body.language ?? "").trim();
  if (!LANGS.has(language)) return NextResponse.json({ error: "invalid language" }, { status: 400 });
  let url = String(body.product_url ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  let host = "";
  try { host = new URL(url).hostname; } catch { /* reported below */ }
  if (!host.includes(".") || url.length > 500) {
    return NextResponse.json({ error: "write the address of your product's page, for example https://www.yourcompany.com/product" }, { status: 400 });
  }
  const asked = Number(body.duration_s);
  const durationS = Math.min(Math.max(Number.isFinite(asked) && asked > 0 ? Math.round(asked) : 20, 12), 30);
  const tone = TONES.has(String(body.tone)) ? String(body.tone) : null;
  // With a presenter: a person of the page opens and closes the video (filmed, paid step by step).
  // Their voice is the stock voice of the language unless one is named with the request.
  const presenter = body.presenter === true;
  const named = String(body.presenter_voice ?? "").trim();
  const presenterVoice = presenter && /^(eleven:)?[A-Za-z][A-Za-z_]{1,40}$/.test(named) ? { voice: named } : null;

  const svc = serviceRoleClient();
  const { data, error: dbError } = await svc.from("video_requests").insert({
    client_slug: actor.clientSlug,
    content_slug: actor.contentSlug,
    status: "draft",
    brief: {
      style: "launch", flow: "staged", request, language, product_url: url, tone, duration_s: durationS,
      ...(presenter ? { presenter: true, ...(presenterVoice ? { presenter_voice: presenterVoice } : {}) } : {}),
      goal: request ? (request.length > 80 ? `${request.slice(0, 77)}...` : request) : `Product launch: ${host}`,
      linked_post_id: null, aspect: "9:16", voice: false, music: false,
    },
    duration_s: durationS,
    // Drawn by the engine itself: nothing is asked of a paid provider.
    cost_estimated_usd: 0,
    created_by: actor.tier.userId,
  }).select("id").single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addEvent(data.id, "created", actor, { style: "launch", product_url: url });
  return NextResponse.json({ id: data.id });
}

async function createAuto(req: NextRequest, body: Record<string, unknown>, actor: VideoActor) {
  const request = String(body.request ?? "").trim();
  const language = String(body.language ?? "").trim();
  const linkedPostId = String(body.linked_post_id ?? "").trim();
  if (request.length < 10) return NextResponse.json({ error: "describe what should happen in the video" }, { status: 400 });
  if (request.length > MAX_REQUEST_CHARS) {
    return NextResponse.json({ error: `at most ${MAX_REQUEST_CHARS} characters` }, { status: 400 });
  }
  if (!LANGS.has(language)) return NextResponse.json({ error: "invalid language" }, { status: 400 });

  const maxS = actor.features.video_max_duration_s;
  const svc = serviceRoleClient();
  const { data, error: dbError } = await svc.from("video_requests").insert({
    client_slug: actor.clientSlug,
    content_slug: actor.contentSlug,
    status: "draft",
    brief: {
      style: "auto", style_by: "agent", request, language,
      // Shot by shot: the client approves script, pictures and shots one at a time.
      ...(actor.features.video_staged_flow ? { flow: "staged" } : {}),
      // Placeholder title until the agent writes one.
      goal: request.length > 80 ? `${request.slice(0, 77)}...` : request,
      linked_post_id: linkedPostId || null, aspect: "9:16", voice: false,
      // What the agent may use, from the client's features (never a checkbox).
      voice_consent: !!actor.features.voice_consent_at,
      max_duration_s: maxS,
    },
    // Provisional: the engine writes the real length and cost once it has chosen.
    duration_s: Math.min(15, maxS),
    cost_estimated_usd: null,
    created_by: actor.tier.userId,
  }).select("id").single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addEvent(data.id, "created", actor, { style: "auto" });
  return NextResponse.json({ id: data.id });
}
