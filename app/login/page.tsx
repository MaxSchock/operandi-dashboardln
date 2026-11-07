import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { pickLang, LOGIN_TEXTS } from "@/lib/login-i18n";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * Login page is a Server Component so we can:
 *   1. Bounce already-authenticated users straight to /dashboard
 *      (avoids the "I'm logged in but stuck on /login" loop).
 *   2. Render the form inside a Suspense boundary so the inner
 *      Client Component can call useSearchParams safely (Next 14 rule).
 *   3. Pick the language from the browser (de, fr, es, en; English otherwise).
 */
export default async function LoginPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) redirect("/dashboard");
  const lang = pickLang(headers().get("accept-language"));

  return (
    <main lang={lang} className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={<div className="text-sm text-slate-500">{LOGIN_TEXTS[lang].loading}</div>}>
        <LoginForm lang={lang} />
      </Suspense>
    </main>
  );
}
