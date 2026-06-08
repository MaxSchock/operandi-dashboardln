"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();

  useEffect(() => {
    const e = params.get("error");
    if (e) setError(decodeURIComponent(e));
  }, [params]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();
    const next = encodeURIComponent("/dashboard");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${next}`,
      },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl text-navy">Operandi Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Magic link sign-in</p>
        {sent ? (
          <p className="mt-6 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">
            Check your inbox. The link expires in 15 minutes.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Send me a magic link
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
