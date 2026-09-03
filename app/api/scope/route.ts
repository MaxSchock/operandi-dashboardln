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
  // A malformed body used to fall through as "all", silently switching the operator to
  // every client while answering ok.
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const raw = (body as Record<string, unknown>).client;
  if (typeof raw !== "string" || !raw.trim()) {
    return NextResponse.json({ error: "client must be a slug or \"all\"" }, { status: 400 });
  }
  const client = raw.trim();
  // Stripping the invalid characters could turn one client's slug into another's, and the
  // operator would never know they were looking at the wrong tenant (Codex, 2026-09-03).
  if (client !== "all" && !/^[a-zA-Z0-9_-]{1,64}$/.test(client)) {
    return NextResponse.json({ error: "client is not a valid slug" }, { status: 400 });
  }
  const value = client;

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
