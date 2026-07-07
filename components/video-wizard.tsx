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
  const [fileWarning, setFileWarning] = useState<string | null>(null);

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
      aspect: fd.get("aspect"),
      hook_type: fd.get("hook_type"),
      topic_pillar: fd.get("topic_pillar"),
      cta_style: fd.get("cta_style"),
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

      <Field label="Style" required>
        <select name="style" required defaultValue="broll" className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
          <option value="broll">Scenes: your uploaded clips plus AI footage, narrator voiceover, captions (recommended)</option>
          <option value="typography">Text-driven: animated text cards, music, no voice</option>
          <option value="talking_head" disabled={!voiceAvailable}>
            Talking head: you speaking to camera{voiceAvailable ? "" : " (needs a recorded voice consent, ask us to set it up)"}
          </option>
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Real footage performs best on LinkedIn: if you upload clips below, we build the video around them.
        </p>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={`Duration (3-${maxDurationS}s, 30-60s performs best)`} required>
          <input name="duration_s" type="number" min={3} max={maxDurationS} defaultValue={Math.min(45, maxDurationS)} required
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
        <Field label="Format" required>
          <select name="aspect" required defaultValue="9:16" className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
            <option value="9:16">Vertical 9:16 (recommended)</option>
            <option value="1:1">Square 1:1</option>
            <option value="16:9">Horizontal 16:9</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Opening hook" required>
          <select name="hook_type" required defaultValue="Bold claim" className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
            <option value="Bold claim">Bold claim (a counterintuitive statement)</option>
            <option value="Question">Question to the viewer</option>
            <option value="Surprising stat">Surprising stat or number</option>
            <option value="Story opening">Story opening (a real moment)</option>
          </select>
        </Field>
        <Field label="Topic pillar" required>
          <select name="topic_pillar" required className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
            <option value="Leadership">Leadership</option>
            <option value="AI at work">AI at work</option>
            <option value="Founder life">Founder life</option>
            <option value="Mindset">Mindset</option>
            <option value="Industry insight">Industry insight</option>
          </select>
        </Field>
        <Field label="CTA style" required>
          <select name="cta_style" required defaultValue="Comment prompt" className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
            <option value="Comment prompt">Invite comments (soft question)</option>
            <option value="Follow for more">Follow for more</option>
            <option value="Link in comments">Link in comments</option>
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

      <Field label="Your photos or clips (optional but recommended, max 20MB per image / 100MB per video)">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          onChange={e => {
            const all = [...(e.target.files ?? [])];
            const ok = all.filter(f => f.size <= (f.type.startsWith("video/") ? 100 * 1024 * 1024 : 20 * 1024 * 1024));
            setFiles(ok);
            setFileWarning(ok.length < all.length
              ? `${all.length - ok.length} file(s) skipped: over the size limit (20MB images, 100MB videos).`
              : null);
          }}
          className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <p className="mt-1 text-xs text-slate-500">
          Short real clips (an event, your office, a keynote moment) make the strongest videos and are used as
          actual footage. Photos guide the look: sharp, well lit, subject centered.
        </p>
        {fileWarning && <div className="mt-1 text-xs text-amber-600">{fileWarning}</div>}
        {files.length > 0 && (
          <div className="mt-1 text-xs text-slate-500">{files.length} file{files.length === 1 ? "" : "s"} selected</div>
        )}
      </Field>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        Next step: we draft a free storyboard (script and shot list) for you to approve.
        Nothing is produced and no budget is used until you approve it.
        The storyboard usually takes about 2 minutes; production takes 15-45 minutes after your approval.
        Spoken words are captioned automatically.
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
