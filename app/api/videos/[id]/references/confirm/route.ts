import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveVideoActor, loadOwnedRequest, addEvent } from "@/lib/videos";
import { headObject } from "@/lib/minio";

const IMAGE_MAX = 20 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;
const AUDIO_MAX = 20 * 1024 * 1024;

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
  const isVideo = (head.mime ?? "").startsWith("video/");
  const isAudio = (head.mime ?? "").startsWith("audio/");
  if (head.size > (isVideo ? VIDEO_MAX : isAudio ? AUDIO_MAX : IMAGE_MAX)) {
    return NextResponse.json({ error: "stored object exceeds the size limit" }, { status: 413 });
  }

  // What the client said the file is for; anything else falls back to the old
  // behaviour (videos are footage, photos are look references). Dialogue
  // videos add the phone clip (screen_clip), the app screenshot (screen), the
  // logo for the end card and one recording per line (meta.line).
  const use = String(body.use ?? "");
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
    const allowed = isVideo ? ["footage", "example", "screen_clip"] : ["look", "as_is", "screen"];
    kind = isVideo ? "reference_video" : "reference_image";
    meta = { use: allowed.includes(use) ? use : allowed[0] };
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
