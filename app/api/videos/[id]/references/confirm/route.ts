import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";
import { headObject } from "@/lib/minio";

const IMAGE_MAX = 20 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;
const AUDIO_MAX = 20 * 1024 * 1024;
// Same lists as the presign route: what is stored is checked, not what was declared.
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const AUDIO_MIME = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/webm"]);

/**
 * POST /api/videos/:id/references/confirm — after the browser PUT, verify the
 * object really exists within limits and record it in video_assets.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json();
  const key = String(body.key ?? "");
  if (!key.startsWith(`refs/${request.client_slug}/${request.id}/`)) {
    return NextResponse.json({ error: "key does not belong to this request" }, { status: 400 });
  }

  const head = await headObject(key);
  if (!head.exists) return NextResponse.json({ error: "object not found in storage" }, { status: 404 });
  const mime = (head.mime ?? "").split(";")[0].trim().toLowerCase();
  const isVideo = VIDEO_MIME.has(mime);
  const isAudio = AUDIO_MIME.has(mime);
  if (!isVideo && !isAudio && !IMAGE_MIME.has(mime)) {
    return NextResponse.json({ error: `unsupported type ${mime || "unknown"}` }, { status: 400 });
  }
  if (head.size > (isVideo ? VIDEO_MAX : isAudio ? AUDIO_MAX : IMAGE_MAX)) {
    return NextResponse.json({ error: "stored object exceeds the size limit" }, { status: 413 });
  }

  // What the client said the file is for; anything else falls back to the old
  // behaviour (videos are footage, photos are look references). Dialogue
  // videos add the phone clip (screen_clip), the app screenshot (screen), the
  // logo for the end card and one recording per line (meta.line).
  const use = String(body.use ?? "");
  // A file that does not match what it is for is refused, not reclassified:
  // an image sent as the phone clip would otherwise become a look reference.
  const needs: Record<string, "video" | "image" | "audio"> = {
    screen_clip: "video", footage: "video", example: "video",
    screen: "image", logo: "image", look: "image", as_is: "image", line: "audio",
    person: "image", swap: "video",
  };
  const got = isVideo ? "video" : isAudio ? "audio" : "image";
  if (needs[use] && needs[use] !== got) {
    return NextResponse.json({ error: `a ${use.replace("_", " ")} must be ${needs[use] === "image" ? "an" : "a"} ${needs[use]}, this file is ${got === "image" ? "an" : "a"} ${got}` }, { status: 400 });
  }
  let kind: "reference_video" | "reference_image" | "reference_audio" | "logo";
  let meta: Record<string, unknown>;
  if (isAudio) {
    const line = Number(body.line);
    if (!Number.isInteger(line) || line < 1 || line > 12) {
      return NextResponse.json({ error: "a recording needs the number of its line" }, { status: 400 });
    }
    kind = "reference_audio";
    meta = { use: "line", line };
  } else if (!isVideo && use === "logo") {
    kind = "logo";
    meta = { use: "logo" };
  } else {
    // "person" and "swap": the photo of who appears and the clip remade with them (videos made step by step).
    const allowed = isVideo ? ["footage", "example", "screen_clip", "swap"] : ["look", "as_is", "screen", "person"];
    kind = isVideo ? "reference_video" : "reference_image";
    // "auto" (one-field form): the engine's agent decides what the file is
    // for from the client's text; until then it behaves like before.
    meta = use === "auto" ? { use: allowed[0], auto: true } : { use: allowed.includes(use) ? use : allowed[0] };
  }

  const svc = serviceRoleClient();
  const { data, error: dbError } = await svc.from("video_assets").insert({
    request_id: request.id,
    kind,
    storage_key: key,
    mime: head.mime,
    size_bytes: head.size,
    meta,
  }).select("id").single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  await addEvent(request.id, "reference_uploaded", actor, { key, mime: head.mime, size: head.size, use: meta.use, line: meta.line ?? null });
  return NextResponse.json({ id: data.id, key });
}
