import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * Login page is a Server Component so we can:
 *   1. Bounce already-authenticated users straight to /dashboard
 *      (avoids the "I'm logged in but stuck on /login" loop).
 *   2. Render the form inside a Suspense boundary so the inner
 *      Client Component can call useSearchParams safely (Next 14 rule).
 */
export default async function LoginPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
