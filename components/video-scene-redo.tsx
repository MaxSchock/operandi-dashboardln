"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sceneRedoCostUsd, type RedoWhat } from "@/lib/video-dialogue";

type Scene = { n: number; kind: string; speaker: string; text: string };

const WHAT_LABEL: Record<RedoWhat, string> = {
  image: "New image (person, place, clothes)",
  motion: "New movement (same image)",
  voice: "New voice (same footage)",
};

/** Guided edit of a delivered dialogue video: one scene made again, the rest
 * reused. Optionally with a new recording of the line. */
export function SceneRedo({ videoId, scenes, redosLeft }: { videoId: string; scenes: Scene[]; redosLeft: number }) {
  const router = useRouter();
  const [n, setN] = useState(scenes[0]?.n ?? 1);
  const [what, setWhat] = useState<RedoWhat>("motion");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement | null>(null);
  const scene = scenes.find(s => s.n === n);
  const options = (Object.keys(WHAT_LABEL) as RedoWhat[]).filter(w => !(w === "image" && scene?.kind === "pantalla"));

  async function submit() {
    setError(null);
    try {
      if (file && what === "voice") {
        setBusy("Uploading the recording...");
        const api = `/api/videos/${videoId}/references`;
        const pres = await fetch(`${api}/presign`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, mime: file.type, size: file.size }) });
        const p = await pres.json();
        if (!pres.ok) throw new Error(p.error ?? pres.status);
        const put = await fetch(p.url, { method: "PUT", headers: { "content-type": p.mime ?? file.type }, body: file });
        if (!put.ok) throw new Error(`upload failed (${put.status})`);
        const conf = await fetch(`${api}/confirm`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: p.key, use: "line", line: n }) });
        if (!conf.ok) throw new Error((await conf.json()).error ?? "confirm failed");
      }
      setBusy("Sending...");
      const res = await fetch(`/api/videos/${videoId}/redo`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ shot: n, what, notes }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? res.status);
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  if (redosLeft <= 0) return <p className="text-[11px] text-slate-400">This video used its scene redos.</p>;
  return (
    <div className="max-w-lg space-y-2 text-xs">
      <div className="flex flex-wrap gap-2">
        <select value={n} onChange={e => { const v = Number(e.target.value); setN(v); if (scenes.find(s => s.n === v)?.kind === "pantalla" && what === "image") setWhat("motion"); }}
          aria-label="Scene" className="rounded border bg-white px-1 py-1">
          {scenes.map(s => <option key={s.n} value={s.n}>Scene {s.n}: {s.speaker ? `${s.speaker}, ` : ""}“{s.text.slice(0, 40)}{s.text.length > 40 ? "…" : ""}”</option>)}
        </select>
        <select value={what} onChange={e => setWhat(e.target.value as RedoWhat)} aria-label="What to redo"
          className="rounded border bg-white px-1 py-1">
          {options.map(w => <option key={w} value={w}>{WHAT_LABEL[w]}</option>)}
        </select>
      </div>
      {what !== "voice" && (
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={500}
          placeholder={what === "image" ? "e.g. She holds the phone lower; a brighter office" : "Optional: what was wrong with the movement"}
          className="w-full rounded-md border bg-white p-2 leading-5" />
      )}
      {what === "voice" && (
        <div className="flex items-center gap-2 text-slate-600">
          <button type="button" onClick={() => pick.current?.click()} className="rounded-md border px-2 py-1">
            {file ? `New recording: ${file.name}` : "Upload a new recording of this line (optional)"}
          </button>
          {file && <button type="button" onClick={() => setFile(null)} className="text-slate-400 hover:text-red-600">remove</button>}
          <input ref={pick} type="file" hidden accept="audio/*" onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        </div>
      )}
      <button type="button" onClick={submit} disabled={!!busy}
        className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50">
        {busy ?? "Redo this scene"}
      </button>
      <p className="text-[11px] text-slate-400">
        Up to about ${sceneRedoCostUsd(scene?.kind ?? "persona", what).toFixed(2)} from your monthly budget, not your weekly slot.
        {` ${redosLeft} scene redo${redosLeft === 1 ? "" : "s"} left for this video.`} The other scenes stay exactly as they are.
      </p>
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-700">{error}</div>}
    </div>
  );
}
