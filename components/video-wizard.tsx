"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LinkedPost = { id: string; label: string };

/**
 * Video request wizard. Submits the brief as JSON, then uploads any reference
 * files straight to MinIO via presigned PUTs (Vercel cannot proxy 100MB
 * bodies), confirming each one so the server records verified assets.
 */
export function VideoWizard({
  maxDurationS,
  voiceAvailable,
  linkedPosts,
}: {
  maxDurationS: number;
  voiceAvailable: boolean;
  linkedPosts: LinkedPost[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      goal: fd.get("goal"),
      key_message: fd.get("key_message"),
      cta: fd.get("cta"),
      style: fd.get("style"),
      language: fd.get("language"),
      duration_s: Number(fd.get("duration_s")),
      voice: fd.get("voice") === "on",
      visual_directions: fd.get("visual_directions"),
      linked_post_id: fd.get("linked_post_id"),
    };

    try {
      setBusy("Creating request...");
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
      const id = data.id as string;

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setBusy(`Uploading reference ${i + 1} of ${files.length}: ${f.name}`);
        const pres = await fetch(`/api/videos/${id}/references/presign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: f.name, mime: f.type, size: f.size }),
        });
        const presData = await pres.json();
        if (!pres.ok) throw new Error(`${f.name}: ${presData.error ?? pres.status}`);
        const put = await fetch(presData.url, { method: "PUT", headers: { "content-type": f.type }, body: f });
        if (!put.ok) throw new Error(`${f.name}: upload failed (${put.status})`);
        const conf = await fetch(`/api/videos/${id}/references/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: presData.key }),
        });
        if (!conf.ok) throw new Error(`${f.name}: confirm failed`);
      }

      setBusy("Done, opening your request...");
      router.push(`/videos/${id}`);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setBusy(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="What should this video achieve?" required>
        <input name="goal" required maxLength={200} placeholder="e.g. Show founders why response time wins deals"
          className="w-full rounded-md border bg-white px-2 py-1.5 text-sm" />
      </Field>

      <Field label="Key message (one sentence the viewer must remember)" required>
        <textarea name="key_message" required rows={2} maxLength={400}
          className="w-full rounded-md border bg-white px-2 py-1.5 text-sm" />
      </Field>

      <Field label="Call to action" required>
        <input name="cta" required maxLength={120} placeholder="e.g. Comment 'speed' and I'll send the checklist"
          className="w-full rounded-md border bg-white px-2 py-1.5 text-sm" />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Style" required>
          <select name="style" required className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
            <option value="typography">Text-driven (animated typography)</option>
            <option value="broll">Scenes (AI b-roll)</option>
            <option value="talking_head" disabled={!voiceAvailable}>
              Talking head{voiceAvailable ? "" : " (needs voice consent)"}
            </option>
          </select>
        </Field>
        <Field label={`Duration (3-${maxDurationS} seconds)`} required>
          <input name="duration_s" type="number" min={3} max={maxDurationS} defaultValue={Math.min(12, maxDurationS)} required
            className="w-full rounded-md border bg-white px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Language" required>
          <select name="language" required className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="fr">French</option>
            <option value="nl">Dutch</option>
            <option value="es">Spanish</option>
          </select>
        </Field>
      </div>

      {voiceAvailable && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="voice" />
          Use my cloned voice for the voiceover
        </label>
      )}

      {linkedPosts.length > 0 && (
        <Field label="Link to a calendar post (optional)">
          <select name="linked_post_id" className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
            <option value="">None</option>
            {linkedPosts.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      )}

      <Field label="Visual directions (optional)">
        <textarea name="visual_directions" rows={3} maxLength={1000}
          placeholder="Colors, mood, things to show or avoid..."
          className="w-full rounded-md border bg-white px-2 py-1.5 text-sm" />
      </Field>

      <Field label="Reference photos or videos (optional, max 20MB per image / 100MB per video)">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          onChange={e => setFiles([...(e.target.files ?? [])])}
          className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        {files.length > 0 && (
          <div className="mt-1 text-xs text-slate-500">{files.length} file{files.length === 1 ? "" : "s"} selected</div>
        )}
      </Field>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        Next step: we draft a free storyboard (script and shot list) for you to approve.
        Nothing is produced and no budget is used until you approve it.
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <button
        disabled={!!busy}
        className="rounded-md bg-electric px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ?? "Request storyboard"}
      </button>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
