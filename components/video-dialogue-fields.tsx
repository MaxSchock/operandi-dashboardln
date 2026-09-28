"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHANGER_VOICES, MAX_LINES, MAX_LINE_CHARS, dialogueCostUsd, dialogueSeconds, lineSeconds,
  type DialogueKind, type DialogueLine,
} from "@/lib/video-dialogue";

export type DialogueRow = DialogueLine & { id: string; recording: File | null };
export type DialogueState = {
  lines: DialogueRow[];
  screenClip: File | null;
  screenshot: File | null;
  logo: File | null;
  endUrl: string;
};
export type DialogueCharacter = { name: string; hasVoice: boolean };

export function emptyDialogue(): DialogueState {
  return { lines: [newRow("persona")], screenClip: null, screenshot: null, logo: null, endUrl: "" };
}

function newRow(kind: DialogueKind, speaker = ""): DialogueRow {
  return { id: crypto.randomUUID(), speaker, text: "", kind, to_phone: false, voice: null, clip_start_s: null, badge: null, recording: null };
}

const KIND_LABEL: Record<DialogueKind, string> = {
  ceo: "You (or your team) to camera",
  persona: "Another person (invented)",
  pantalla: "Your app on the phone",
};

/** Dialogue brief: one row per line, in order. Each line becomes one scene. */
export function DialogueFields({
  value, onChange, characters, maxDurationS,
}: {
  value: DialogueState;
  onChange: (v: DialogueState) => void;
  characters: DialogueCharacter[];
  maxDurationS: number;
}) {
  const set = (patch: Partial<DialogueState>) => onChange({ ...value, ...patch });
  const setRow = (i: number, patch: Partial<DialogueRow>) =>
    set({ lines: value.lines.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.lines.length) return;
    const lines = [...value.lines];
    [lines[i], lines[j]] = [lines[j], lines[i]];
    set({ lines });
  };

  const filled = value.lines.filter(l => l.text.trim());
  const seconds = dialogueSeconds(filled);
  const cost = dialogueCostUsd(filled);
  const needsScreen = value.lines.some(l => l.kind === "pantalla");
  const tooLong = seconds > maxDurationS;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {value.lines.map((row, i) => (
          <div key={row.id} className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-navy">Scene {i + 1}</span>
              <select value={row.kind} aria-label={`Who appears in scene ${i + 1}`}
                onChange={e => {
                  const kind = e.target.value as DialogueKind;
                  setRow(i, { kind, speaker: kind === "ceo" ? (characters[0]?.name ?? "") : kind === "pantalla" ? (characters[0]?.name ?? row.speaker) : row.speaker });
                }}
                className="rounded border bg-white px-1 py-0.5">
                {(Object.keys(KIND_LABEL) as DialogueKind[]).map(k => (
                  <option key={k} value={k} disabled={k === "ceo" && characters.length === 0}>{KIND_LABEL[k]}</option>
                ))}
              </select>
              {row.kind === "ceo" ? (
                <select value={row.speaker} aria-label="Who speaks" onChange={e => setRow(i, { speaker: e.target.value })}
                  className="rounded border bg-white px-1 py-0.5">
                  {characters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              ) : (
                <input value={row.speaker} maxLength={60} aria-label="Who speaks"
                  placeholder={row.kind === "pantalla" ? "Who speaks in the app (e.g. your avatar)" : "Who speaks (e.g. a customer)"}
                  onChange={e => setRow(i, { speaker: e.target.value })}
                  className="w-56 rounded border bg-white px-1 py-0.5" />
              )}
              <span className="ml-auto text-slate-400">~{lineSeconds(row)} s</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === value.lines.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move down">↓</button>
              <button type="button" onClick={() => set({ lines: value.lines.filter((_, j) => j !== i) })}
                disabled={value.lines.length === 1} className="text-slate-400 hover:text-red-600 disabled:opacity-30">remove</button>
            </div>
            <textarea value={row.text} rows={2} maxLength={MAX_LINE_CHARS} aria-label={`Line ${i + 1}`}
              placeholder="Exactly what is said. We never change your words."
              onChange={e => setRow(i, { text: e.target.value })}
              className="w-full rounded-md border bg-white px-2 py-1.5 text-sm" />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <Recorder n={i + 1} file={row.recording} onChange={f => setRow(i, { recording: f })} />
              {row.kind === "persona" && (<>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={row.to_phone} onChange={e => setRow(i, { to_phone: e.target.checked })} />
                  speaks into the phone (voice message)
                </label>
                <label className="flex items-center gap-1">voice
                  <select value={row.voice ?? ""} onChange={e => setRow(i, { voice: e.target.value || null })}
                    className="rounded border bg-white px-1 py-0.5">
                    <option value="">Charlotte (default)</option>
                    {CHANGER_VOICES.filter(v => v !== "Charlotte").map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </>)}
              {row.kind === "pantalla" && (
                <label className="flex items-center gap-1">clip from second
                  <input type="number" min={0} step={0.5} value={row.clip_start_s ?? ""} placeholder="auto"
                    onChange={e => setRow(i, { clip_start_s: e.target.value === "" ? null : Number(e.target.value) })}
                    className="w-16 rounded border bg-white px-1 py-0.5" />
                </label>
              )}
              <label className="flex items-center gap-1">label on screen
                <input value={row.badge ?? ""} maxLength={40} placeholder="optional, e.g. Answers in real time"
                  onChange={e => setRow(i, { badge: e.target.value || null })}
                  className="w-52 rounded border bg-white px-1 py-0.5" />
              </label>
            </div>
          </div>
        ))}
        {value.lines.length < MAX_LINES && (
          <button type="button" onClick={() => set({ lines: [...value.lines, newRow(value.lines.at(-1)?.kind === "persona" ? "pantalla" : "persona")] })}
            className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-400">
            + Add a line
          </button>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Record each line in your own voice (or upload a voice note): we turn it into the voice of whoever speaks,
        with your timing and intonation. A line without a recording is read by a synthetic voice.
        {characters.some(c => c.hasVoice) && ` Lines spoken by ${characters.filter(c => c.hasVoice).map(c => c.name).join(", ")} use their real voice.`}
      </p>

      {needsScreen && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FilePick label="Phone clip (a hand holding the phone, screen visible)" accept="video/mp4,video/quicktime,video/webm"
            file={value.screenClip} onChange={f => set({ screenClip: f })} max={100} />
          <FilePick label="Screenshot of your app (what the phone must show)" accept="image/png,image/jpeg,image/webp"
            file={value.screenshot} onChange={f => set({ screenshot: f })} max={20} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FilePick label="Logo for the end card (PNG with transparency is best)" accept="image/png,image/jpeg,image/webp"
          file={value.logo} onChange={f => set({ logo: f })} max={20} />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Web address on the end card</label>
          <input value={value.endUrl} maxLength={80} placeholder="e.g. yourcompany.com"
            onChange={e => set({ endUrl: e.target.value })}
            className="w-full rounded-md border bg-white px-2 py-1.5 text-sm" />
        </div>
      </div>

      <div className={`rounded-md border p-2 text-xs ${tooLong ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
        About {seconds} s with the end card{tooLong ? ` (your plan allows ${maxDurationS} s: shorten or remove a line)` : ""}.
        Estimated production cost: ${cost.toFixed(2)}.
      </div>
    </div>
  );
}

function FilePick({ label, accept, file, onChange, max }: {
  label: string; accept: string; file: File | null; onChange: (f: File | null) => void; max: number;
}) {
  const [warn, setWarn] = useState<string | null>(null);
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {file ? (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="truncate">{file.name}</span>
          <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-red-600">remove</button>
        </div>
      ) : (
        <input type="file" accept={accept}
          onChange={e => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > max * 1024 * 1024) { setWarn(`Over ${max}MB`); return; }
            setWarn(null); onChange(f);
          }}
          className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700" />
      )}
      {warn && <div className="mt-1 text-xs text-amber-600">{warn}</div>}
    </div>
  );
}

/** Record a line in the browser, or pick an audio file (a WhatsApp voice note works). */
function Recorder({ n, file, onChange }: { n: number; file: File | null; onChange: (f: File | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const pick = useRef<HTMLInputElement | null>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const alive = useRef(true);
  // Leaving the form mid-recording must release the microphone.
  useEffect(() => {
    alive.current = true;
    return () => {
    alive.current = false;
    const mr = rec.current;
    if (mr) { mr.onstop = null; if (mr.state !== "inactive") mr.stop(); mr.stream.getTracks().forEach(t => t.stop()); }
    };
  }, []);

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The form may be gone by the time the browser grants the microphone.
      if (!alive.current) { stream.getTracks().forEach(t => t.stop()); return; }
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const type = (mr.mimeType || "audio/webm").split(";")[0];
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        onChange(new File(chunks, `line${n}.${ext}`, { type }));
        setRecording(false);
      };
      rec.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setErr("No microphone access. Allow it in the browser or upload a file.");
    }
  }

  if (file) {
    return (
      <span className="flex items-center gap-2">
        <audio controls src={url ?? undefined} className="h-7" />
        <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-red-600">record again</button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      {recording ? (
        <button type="button" onClick={() => rec.current?.stop()}
          className="rounded-md bg-red-600 px-2 py-1 font-medium text-white">■ Stop</button>
      ) : (
        <button type="button" onClick={start}
          className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">● Record line</button>
      )}
      <button type="button" onClick={() => pick.current?.click()} className="text-slate-500 underline">or upload audio</button>
      <input ref={pick} type="file" hidden accept="audio/*"
        onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f); e.target.value = ""; }} />
      {err && <span className="text-amber-600">{err}</span>}
    </span>
  );
}
