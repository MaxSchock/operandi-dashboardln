import { NextResponse } from "next/server";
import { loadContent } from "@/lib/content-load";

export const dynamic = "force-dynamic";

/**
 * GET /api/content — what the Content page shows, as data (RLS and the sidebar
 * scope apply exactly as on the page). The board asks for it in the background
 * and redraws only the cards that changed.
 */
export async function GET() {
  const data = await loadContent();
  if (!data) return NextResponse.json({ error: "auth required" }, { status: 401 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
