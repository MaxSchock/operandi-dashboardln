import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/scope  { client: "all" | "<slug>" }
 *
 * Sets the global tenant scope cookie. The sidebar selector calls this on
 * change, then the client router.refresh() picks up the new scope on every
 * server-rendered page.
 *
 * No auth check here: the layout already gates the whole (app) tree behind
 * a Supabase session, so anyone reaching this route is logged in. RLS still
 * enforces tenant isolation at the data layer regardless of cookie value.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const client = typeof body.client === "string" ? body.client : "all";
  const value = client === "all" ? "all" : client.replace(/[^a-z0-9_-]/gi, "").slice(0, 64);

  const res = NextResponse.json({ ok: true, scope: value });
  res.cookies.set("operandi_scope", value, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
