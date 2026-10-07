"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TONES: [string, string][] = [
  ["", "We choose what fits your product"],
  ["default", "Punchy, playful, clean"],
  ["polished", "Polished: serious, elegant, restrained"],
  ["cinematic", "Cinematic: trailer scale, big type"],
  ["app-store", "App store: clean feature cards"],
  ["deadpan", "Deadpan: calm and dry"],
  ["yc-parody", "Startup launch, played straight"],
  ["chaotic", "Chaotic: fast and loud"],
];

/**
 * Product launch video: one sentence and the address of the product's page.
 * The engine opens the page, takes its copy, colours, fonts, logo and
 * pictures, and proposes animated scenes the client edits in the script
 * (video-engine app/launch.py). No people, no voice; drawing it uses none of
 * the production budget.
 */
export function VideoRequestLaunch({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    try {
      setBusy("Creating request...");
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          style: "launch",
          request: fd.get("request"),
          product_url: fd.get("product_url"),
          tone: fd.get("tone"),
          duration_s: Number(fd.get("duration_s")),
          language: fd.get("language"),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
      const sub = await fetch(`/api/videos/${data.id}/submit`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      if (!sub.ok) throw new Error((await sub.json()).error ?? `submit failed (${sub.status})`);
      setBusy("Done, opening your request...");
      router.push(`/videos/${data.id}`);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setBusy(null);
    }
  }

  const field = "w-full rounded-md border bg-white px-2 py-1.5 text-sm";
  const label = "mb-1 block text-xs font-medium text-slate-600";
  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="launch-form">
      <div>
        <label className={label}>The page of your product or service<span className="text-red-500"> *</span></label>
        <input name="product_url" required type="text" inputMode="url" maxLength={500}
          placeholder="https://www.yourcompany.com/product" className={field} />
        <p className="mt-1 text-xs text-slate-500">
          We open this page and build the video from what is on it: its words, colours, fonts, logo and
          pictures. Nothing is shown that the page does not say.
        </p>
      </div>
      <div>
        <label className={label}>What should the video put first? (one sentence, optional)</label>
        <textarea name="request" rows={2} maxLength={400}
          placeholder="e.g. Show how fast you get your own avatar, and end with the free trial." className={field} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label}>Tone</label>
          <select name="tone" className={field}>
            {TONES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Length</label>
          <select name="duration_s" defaultValue="20" className={field}>
            <option value="15">About 15 seconds</option>
            <option value="20">About 20 seconds</option>
            <option value="25">About 25 seconds</option>
          </select>
        </div>
        <div>
          <label className={label}>Language<span className="text-red-500"> *</span></label>
          <select name="language" required className={field}>
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="fr">French</option>
            <option value="nl">Dutch</option>
            <option value="es">Spanish</option>
          </select>
        </div>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        Next step: the scenes of the video as a script (about 2 minutes). You change any line there, then the
        scenes are drawn. Animated graphics only: no people, no voice, none of your production budget.
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      <div className="flex items-center gap-3">
        <button disabled={!!busy}
          className="rounded-md bg-electric px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ?? "Request the scenes"}
        </button>
        <button type="button" onClick={onBack} disabled={!!busy} className="text-xs text-slate-500 hover:text-slate-700">
          {backLabel}
        </button>
      </div>
    </form>
  );
}
