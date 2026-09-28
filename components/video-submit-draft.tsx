"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** A request whose upload was interrupted stays a draft: hand it to the
 * engine with the files that did arrive. */
export function SubmitDraft({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/submit`, { method: "POST" });
      if (res.ok) router.refresh();
      else setError((await res.json().catch(() => ({}))).error ?? `failed (${res.status})`);
    } catch {
      setError("No connection. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 text-xs text-slate-600">
      <p>The upload of your files stopped before the end. Check the files below, then start production with what arrived.</p>
      <button type="button" onClick={go} disabled={busy}
        className="rounded-md bg-navy px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50">
        {busy ? "Starting..." : "Start production"}
      </button>
      {error && <div className="text-red-700">{error}</div>}
    </div>
  );
}
