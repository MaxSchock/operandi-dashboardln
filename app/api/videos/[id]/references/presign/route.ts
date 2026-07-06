import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { resolveVideoActor, loadOwnedRequest } from "@/lib/videos";
import { presignPut } from "@/lib/minio";

const IMAGE_MAX = 20 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;
const MIME_ALLOW: Record<string, "reference_image" | "reference_video"> = {
  "image/jpeg": "reference_image",
  "image/png": "reference_image",
  "image/webp": "reference_image",
  "video/mp4": "reference_video",
  "video/quicktime": "reference_video",
  "video/webm": "reference_video",
};

/**
 * POST /api/videos/:id/references/presign — issue a presigned PUT so the
 * browser uploads straight to MinIO (Vercel caps request bodies at ~4.5MB, so
 * proxying is not an option). The declared size/mime are re-verified against
 * the stored object in the confirm step.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (["published", "closed", "rejected"].includes(request.status)) {
    return NextResponse.json({ error: "request is closed" }, { status: 409 });
  }

  const body = await req.json();
  const filename = String(body.filename ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const mime = String(body.mime ?? "");
  const size = Number(body.size ?? 0);

  const kind = MIME_ALLOW[mime];
  if (!kind) return NextResponse.json({ error: `unsupported type ${mime}` }, { status: 400 });
  const max = kind === "reference_image" ? IMAGE_MAX : VIDEO_MAX;
  if (!size || size > max) {
    return NextResponse.json({ error: `file too large (max ${Math.round(max / 1024 / 1024)}MB)` }, { status: 413 });
  }

  const key = `refs/${request.client_slug}/${request.id}/${randomUUID()}-${filename}`;
  const url = await presignPut(key, mime);
  return NextResponse.json({ url, key, mime });
}
