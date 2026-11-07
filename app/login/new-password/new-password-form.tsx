"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LOGIN_TEXTS, type Lang } from "@/lib/login-i18n";

const MIN_LENGTH = 8;

export function NewPasswordForm({ lang, email }: { lang: Lang; email: string }) {
  const t = LOGIN_TEXTS[lang];
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) { setError(t.passwordTooShort); return; }
    if (password !== repeat) { setError(t.passwordsDiffer); return; }
    setSubmitting(true);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) { setError(error.message); return; }
      router.refresh();
      router.push("/dashboard");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-sm">
      <h1 className="font-display text-2xl text-navy">Operandi Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">{t.newPasswordTitle}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        {/* The address travels with the form so password managers store the pair. */}
        <input type="email" value={email} readOnly autoComplete="username"
               className="w-full rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-500" />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t.newPasswordPlaceholder}
          className="w-full rounded-md border px-3 py-2 text-sm"
          autoComplete="new-password"
        />
        <input
          type="password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          placeholder={t.repeatPasswordPlaceholder}
          className="w-full rounded-md border px-3 py-2 text-sm"
          autoComplete="new-password"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "…" : t.savePassword}
        </button>
        {error && <p className="text-sm text-red-600 break-words">{error}</p>}
      </form>
    </div>
  );
}
