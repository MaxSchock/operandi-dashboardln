import { NextRequest, NextResponse } from "next/server";
import { resolveVideoActor, loadOwnedRequest } from "@/lib/videos";
import { presignGet } from "@/lib/minio";

/**
 * GET /api/videos/:id/deliverable — redirect to a presigned MinIO URL for the
 * current deliverable (private bucket; links expire after an hour).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, error, status } = await resolveVideoActor();
  if (!actor) return NextResponse.json({ error }, { status });

  const { id } = await ctx.params;
  const request = await loadOwnedRequest(id, actor);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!request.deliverable_key) return NextResponse.json({ error: "no deliverable yet" }, { status: 404 });

  const url = await presignGet(request.deliverable_key, 3600);
  return NextResponse.redirect(url, 302);
}
