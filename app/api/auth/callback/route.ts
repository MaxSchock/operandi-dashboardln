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
 * Also accepts ?token_hash=&type=, the server-side form used by links minted
 * with the admin generate_link API. Those are how we hand someone access
 * without going through their inbox; the plain action_link cannot work here
 * because it comes back with the tokens in the URL fragment, which never
 * reaches the server.
 *
 * Edge cases handled:
 *  - Neither ?code nor ?token_hash → bounce to /login?error=no_code.
 *  - exchange/verify fails → bounce to /login?error=<msg>.
 *  - `next` query param not starting with "/" → coerce to /dashboard
 *    so we never become an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type") ?? "magiclink";
  const errorParam = searchParams.get("error_description") || searchParams.get("error");
  let next = searchParams.get("next") ?? "/dashboard";
  if (!next.startsWith("/")) next = "/dashboard";

  if (errorParam) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorParam)}`);
  }

  if (!code && !tokenHash) {
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

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: otpType as "magiclink" | "recovery" | "invite" | "email",
      });
  if (error) {
    console.error("[callback] sign-in failed:", error.message);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return response;
}
