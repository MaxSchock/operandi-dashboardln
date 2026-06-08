import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase Auth magic-link callback.
 *
 * The PKCE flow sends the user here with `?code=...&next=/dashboard`.
 * We exchange the code for a session (this sets the cookie via the
 * server client) and redirect to `next` (sanitized to a path on this host).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/dashboard";

  // Only allow same-origin relative paths in `next` to avoid open redirects.
  if (!next.startsWith("/")) next = "/dashboard";

  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Implicit (hash-fragment) flow: the token is in the URL fragment which
  // the server cannot see. Bounce to a tiny client-side page that handles it.
  return NextResponse.redirect(`${origin}/login?error=no_code`);
}
