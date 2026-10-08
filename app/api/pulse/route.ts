import { NextRequest, NextResponse } from "next/server";
import { getTier } from "@/lib/tier";
import { pulse } from "@/lib/pulse";

export const dynamic = "force-dynamic";

/**
 * GET /api/pulse?path=/calling — a short mark of the data behind a screen
 * (lib/pulse.ts). `mark: null` means the screen keeps itself up to date or
 * has nothing that changes by itself.
 */
export async function GET(req: NextRequest) {
  const tier = await getTier();
  if (!tier.userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const mark = await pulse(req.nextUrl.searchParams.get("path") ?? "");
  return NextResponse.json({ mark }, { headers: { "cache-control": "no-store" } });
}
