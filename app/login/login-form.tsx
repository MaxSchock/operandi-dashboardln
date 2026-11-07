"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LOGIN_TEXTS, safeNext, type Lang } from "@/lib/login-i18n";

type Mode = "magic" | "password" | "reset";

export function LoginForm({ lang }: { lang: Lang }) {
  const t = LOGIN_TEXTS[lang];
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const e = params.get("error");
    if (e) setError(e === "link_expired" ? t.linkExpired : decodeURIComponent(e));
  }, [params, t.linkExpired]);

  function switchTo(m: Mode) {
    setMode(m);
    setError(null);
    setSent(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();

      if (mode === "magic") {
        const next = encodeURIComponent(safeNext(params.get("next")));
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

      if (mode === "reset") {
        // The link lands on the callback, which opens a session and sends the person
        // to the page where the new password is set.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent("/login/new-password")}`,
        });
        if (error) setError(error.message);
        else setSent(true);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
      // Force the router to re-run server components so the middleware
      // sees the new cookies, then push to dashboard.
      router.refresh();
      router.push(safeNext(params.get("next")));
    } catch {
      setError(t.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === "magic" ? t.magicTitle : mode === "password" ? t.passwordTitle : t.resetTitle;
  const submitLabel = mode === "magic" ? t.sendMagic : mode === "password" ? t.signIn : t.sendReset;

  return (
    <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-sm">
      <h1 className="font-display text-2xl text-navy">Operandi Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">{title}</p>

      {sent ? (
        <div className="mt-6 space-y-2">
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">
            {mode === "reset" ? t.resetSent : t.magicSent}
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="w-full text-xs text-slate-500 hover:text-slate-700"
          >
            {t.sendAnother}
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.emailPlaceholder}
            className="w-full rounded-md border px-3 py-2 text-sm"
            autoComplete="email"
          />
          {mode === "password" && (
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPlaceholder}
              className="w-full rounded-md border px-3 py-2 text-sm"
              autoComplete="current-password"
            />
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "…" : submitLabel}
          </button>
          {error && <p className="text-sm text-red-600 break-words">{error}</p>}
        </form>
      )}

      <div className="mt-4 space-y-1 text-center">
        {mode === "password" && (
          <button
            type="button"
            onClick={() => switchTo("reset")}
            className="w-full text-xs text-slate-500 hover:text-slate-700"
          >
            {t.forgotPassword}
          </button>
        )}
        {mode === "reset" ? (
          <button
            type="button"
            onClick={() => switchTo("password")}
            className="w-full text-xs text-slate-500 hover:text-slate-700"
          >
            {t.backToSignIn}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => switchTo(mode === "magic" ? "password" : "magic")}
            className="w-full text-xs text-slate-500 hover:text-slate-700"
          >
            {mode === "magic" ? t.usePassword : t.useMagic}
          </button>
        )}
      </div>
    </div>
  );
}
