"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "magic" | "password";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const e = params.get("error");
    if (e) setError(decodeURIComponent(e));
  }, [params]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();

    if (mode === "magic") {
      const next = encodeURIComponent("/dashboard");
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${next}`,
        },
      });
      if (error) setError(error.message);
      else setSent(true);
      return;
    }

    // password mode
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl text-navy">Operandi Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "magic" ? "Magic link sign-in" : "Password sign-in"}
        </p>

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
              autoComplete="email"
            />
            {mode === "password" && (
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                className="w-full rounded-md border px-3 py-2 text-sm"
                autoComplete="current-password"
              />
            )}
            <button
              type="submit"
              className="w-full rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {mode === "magic" ? "Send me a magic link" : "Sign in"}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        )}

        <button
          type="button"
          onClick={() => { setMode(mode === "magic" ? "password" : "magic"); setError(null); setSent(false); }}
          className="mt-4 w-full text-center text-xs text-slate-500 hover:text-slate-700"
        >
          {mode === "magic" ? "Use password instead" : "Use magic link instead"}
        </button>
      </div>
    </main>
  );
}
