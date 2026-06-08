import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PUBLIC_PATHS = ["/login"];

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

  const { data: { user } } = await supabase.auth.getUser();
  const path = url.pathname;

  const isPublic = PUBLIC_PATHS.some(p => path.startsWith(p));
  if (!user && !isPublic) {
    const dest = url.clone();
    dest.pathname = "/login";
    dest.search = "";
    dest.searchParams.set("next", path);
    return NextResponse.redirect(dest);
  }

  // /admin/* requires operandi_admin role.
  if (path.startsWith("/admin") && user) {
    const { data: cu } = await supabase
      .schema("outreach")
      .from("client_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
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
