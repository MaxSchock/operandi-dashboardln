import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthOutage } from "@/lib/auth-outage";
import { LOGIN_TEXTS, pickLang } from "@/lib/login-i18n";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PUBLIC_PATHS = ["/login"];

/** 503 page in the reader's language; access stays closed, nothing is cached. */
function unavailable(req: NextRequest) {
  const lang = pickLang(req.headers.get("accept-language"));
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Operandi Dashboard</title></head>`
    + `<body style="font-family:system-ui,sans-serif;background:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px">`
    + `<main style="max-width:24rem;background:#fff;border:1px solid #e2e8f0;border-radius:1rem;padding:2rem">`
    + `<h1 style="font-size:1.5rem;margin:0 0 .5rem">Operandi Dashboard</h1>`
    + `<p style="color:#475569;font-size:.9rem;margin:0">${LOGIN_TEXTS[lang].authUnavailable}</p></main></body></html>`;
  return new NextResponse(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "retry-after": "60", "cache-control": "no-store" },
  });
}

export async function middleware(req: NextRequest) {
  // ----------------------------------------------------------------
  // SAFETY NET — magic link landing on the wrong path.
  //
  // If Supabase has a misconfigured Site URL / Redirect URLs and the
  // verifier redirects the user to "/" or "/dashboard" with the auth
  // code in the query string, the request never reaches our callback
  // route. We catch the ?code= here and forward to /api/auth/callback
  // with the original path preserved as ?next=…
  // ----------------------------------------------------------------
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  if (code && !url.pathname.startsWith("/api/auth/callback")) {
    const target = url.clone();
    target.pathname = "/api/auth/callback";
    target.searchParams.set("next", url.pathname);
    // (code is already a search param so it travels along with target)
    return NextResponse.redirect(target);
  }

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(items: CookieToSet[]) {
          items.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  const path = url.pathname;

  const isPublic = PUBLIC_PATHS.some(p => path.startsWith(p));
  // Supabase unreachable is not a logout: say so instead of bouncing to /login.
  if (!user && !isPublic && isAuthOutage(userError)) {
    console.error("[middleware] session check failed:", userError?.message);
    return unavailable(req);
  }
  if (!user && !isPublic) {
    const dest = url.clone();
    dest.pathname = "/login";
    dest.search = "";
    dest.searchParams.set("next", path);
    return NextResponse.redirect(dest);
  }

  // /admin/* requires operandi_admin role.
  if (path.startsWith("/admin") && user) {
    const { data: cu, error: roleError } = await supabase
      .schema("outreach")
      .from("client_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    // A failed role lookup denies access but is not reported as "not an admin".
    if (roleError) {
      console.error("[middleware] role lookup failed:", roleError.message);
      return unavailable(req);
    }
    if (cu?.role !== "operandi_admin") {
      const dest = url.clone();
      dest.pathname = "/dashboard";
      dest.search = "";
      return NextResponse.redirect(dest);
    }
  }

  return res;
}

export const config = {
  // Skip the middleware on the auth callback (it must own its response) and on
  // static asset paths. Everything else passes through, including pages with
  // a `?code=...` query, which we trap above and forward to the callback.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
