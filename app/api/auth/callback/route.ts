import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase Auth magic-link callback (PKCE).
 *
 * Critical detail: in Next 14+ Route Handlers, cookies set via the
 * next/headers `cookies()` helper do NOT travel onto a NextResponse
 * we return ourselves. Cookies must be written directly on the
 * NextResponse object that is returned. The previous version that
 * used the shared cookieStore helper failed for exactly this reason.
 *
 * Edge cases handled:
 *  - No ?code in URL → bounce to /login?error=no_code (probably an
 *    implicit-flow email; we force PKCE in the browser client).
 *  - exchangeCodeForSession fails → bounce to /login?error=<msg>.
 *  - `next` query param not starting with "/" → coerce to /dashboard
 *    so we never become an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error_description") || searchParams.get("error");
  let next = searchParams.get("next") ?? "/dashboard";
  if (!next.startsWith("/")) next = "/dashboard";

  if (errorParam) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorParam)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(items: CookieToSet[]) {
          items.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[callback] exchangeCodeForSession failed:", error.message);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return response;
}
