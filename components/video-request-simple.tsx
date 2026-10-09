"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PayDialog, type MonthSpend } from "@/components/video-pay";
import { HEAR_USD, HEAR_MAX_VIDEOS } from "@/lib/video-staged";

type LinkedPost = { id: string; label: string };

// Same limit as MAX_REQUEST_CHARS in lib/videos.ts (server-only module).
const MAX_CHARS = 2000;

const fileId = (f: File) => `${f.name}-${f.size}-${f.type}-${f.lastModified}`;

/**
 * The client's video form: one field saying what should happen, the language
 * and optional files. The engine's agent picks the style, length, message,
 * CTA and (for a dialogue) the lines, and the client checks all of it in the
 * free script (called storyboard in the older flow) (video-engine app/decide.py). Files go up like in the
 * detailed form, marked "auto": the agent decides what each one is for.
 */
export function VideoRequestSimple({
  maxDurationS,
  linkedPosts,
  characters = [],
  keyframeReview = false,
  staged = false,
  spend = null,
}: {
  /** Step-by-step flow: uploaded clips are listened to (paid) to write the script. */
  staged?: boolean;
  spend?: MonthSpend | null;
  maxDurationS: number;
  linkedPosts: LinkedPost[];
  /** Names of the client's approved characters, shown as a hint. */
  characters?: string[];
  keyframeReview?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // What the client said a file is for; unsaid, the agent decides.
  const [uses, setUses] = useState<Record<string, string>>({});
  const [fileWarning, setFileWarning] = useState<string | null>(null);

  const who = characters.length ? characters.join(" or ") : "someone from your team";
  const host = characters[0] ?? "our founder";
  const example = `e.g. A customer asks ${host} "How fast can I start?" and ${host} answers that it only takes one call. End with our website.`;

  // One word for one thing: the step-by-step flow calls it the script on every screen.
  const word = staged ? "script" : "storyboard";
  const [confirm, setConfirm] = useState<FormData | null>(null);
  const hearPrice = staged
    ? Math.round(Math.min(files.filter(f => f.type.startsWith("video/")).length, HEAR_MAX_VIDEOS) * HEAR_USD * 100) / 100
    : 0;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Listening to the clips is the one paid part of this step: price first.
    if (hearPrice > 0) setConfirm(fd);
    else void send(fd, false);
  }

  async function send(fd: FormData, hear: boolean) {
    setConfirm(null);
    setError(null);
    try {
      setBusy("Creating request...");
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          style: "auto",
          request: fd.get("request"),
          language: fd.get("language"),
          linked_post_id: fd.get("linked_post_id"),
          product_url: fd.get("product_url") ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
      const id = data.id as string;

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setBusy(`Uploading file ${i + 1} of ${files.length}: ${f.name}`);
        const pres = await fetch(`/api/videos/${id}/references/presign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: f.name, mime: f.type, size: f.size }),
        });
        const presData = await pres.json();
        if (!pres.ok) throw new Error(`${f.name}: ${presData.error ?? pres.status}`);
        const put = await fetch(presData.url, { method: "PUT", headers: { "content-type": presData.mime ?? f.type }, body: f });
        if (!put.ok) throw new Error(`${f.name}: upload failed (${put.status})`);
        const conf = await fetch(`/api/videos/${id}/references/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: presData.key, use: uses[fileId(f)] || "auto" }),
        });
        if (!conf.ok) throw new Error(`${f.name}: confirm failed`);
      }

      const sub = await fetch(`/api/videos/${id}/submit`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hear }),
      });
      if (!sub.ok) throw new Error((await sub.json()).error ?? `submit failed (${sub.status})`);

      setBusy("Done, opening your request...");
      router.push(`/videos/${id}`);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setBusy(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="What should happen in the video?" required>
        <textarea name="request" required minLength={10} maxLength={MAX_CHARS} rows={6} placeholder={example}
          className="w-full rounded-md border bg-white px-2 py-1.5 text-sm leading-5" />
        <p className="mt-1 text-xs text-slate-500">
          Write it the way you would explain it to a colleague: who is in it ({who}, a customer, your app),
          what they say or do, and how it ends. Words in quotation marks are said exactly as you wrote them.
          We choose the kind of video and its length (up to {maxDurationS} seconds); you see and change
          everything in the {word} before anything is produced.
        </p>
      </Field>

      {staged && (
        <Field label="A web page of yours (optional)">
          <input name="product_url" type="text" inputMode="url" maxLength={500} placeholder="https://www.yourcompany.com/product"
            className="w-full rounded-md border bg-white px-2 py-1.5 text-sm" data-testid="request-page" />
          <p className="mt-1 text-xs text-slate-500" data-testid="help-page">
            We turn this page into animated scenes with its own text, colours and pictures. Without a page
            there are no animated scenes: the video is made with people, your clips or text.
          </p>
        </Field>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Language" required>
          <select name="language" required className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="fr">French</option>
            <option value="nl">Dutch</option>
            <option value="es">Spanish</option>
          </select>
        </Field>
        {linkedPosts.length > 0 && (
          <Field label="Link to a calendar post (optional)">
            <select name="linked_post_id" className="w-full rounded-md border bg-white px-2 py-1.5 text-sm">
              <option value="">None</option>
              {linkedPosts.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
        )}
      </div>

      <Field label="Files (optional): your clips, photos, app screenshots, logo">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          onChange={e => {
            const all = [...(e.target.files ?? [])];
            const ok = all.filter(f => f.size <= (f.type.startsWith("video/") ? 100 * 1024 * 1024 : 20 * 1024 * 1024));
            // Each pick adds to the list (Cardeleine, 2026-09-23).
            setFiles(prev => [...prev, ...ok.filter(f => !prev.some(p => p.name === f.name && p.size === f.size))]);
            setFileWarning(ok.length < all.length
              ? `${all.length - ok.length} file(s) skipped: over the size limit (20MB images, 100MB videos).`
              : null);
            e.target.value = "";
          }}
          className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <ul className="mt-1 space-y-0.5 text-xs text-slate-500" data-testid="help-files">
          <li><span className="font-medium text-slate-600">A photo of a person:</span> they can present the video, talking to the camera.</li>
          <li><span className="font-medium text-slate-600">A video of yours:</span> we cut the part that fits into the video, or remake it with another person.</li>
          <li><span className="font-medium text-slate-600">A video you like as a model:</span> we copy its pace and its shots; nothing of it is shown.</li>
          <li><span className="font-medium text-slate-600">A screenshot of your app or your logo:</span> shown exactly as it is.</li>
        </ul>
        <p className="mt-1 text-xs text-slate-500">Pick below what each file is for, or leave it to us.</p>
        {hearPrice > 0 && (
          <p className="mt-1 text-xs text-slate-600" data-testid="hear-price">
            We listen to your {hearPrice > HEAR_USD ? "clips" : "clip"} so the script uses the words really said in
            {hearPrice > HEAR_USD ? " them" : " it"}: ${hearPrice.toFixed(2)} of your production budget. You confirm it when you send the request.
          </p>
        )}
        {fileWarning && <div className="mt-1 text-xs text-amber-600">{fileWarning}</div>}
        {files.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
            {files.map((f, i) => (
              <li key={`${f.name}-${f.size}`} className="flex items-center gap-2">
                <span className="truncate">{f.type.startsWith("video/") ? "🎞" : "🖼"} {f.name}</span>
                <select value={uses[fileId(f)] ?? ""} onChange={e => setUses(u => ({ ...u, [fileId(f)]: e.target.value }))}
                  className="rounded border bg-white px-1 py-0.5 text-[11px] text-slate-600" data-testid="file-use" aria-label={`What ${f.name} is for`}>
                  <option value="">We decide what it is for</option>
                  {f.type.startsWith("video/")
                    ? <>
                        <option value="footage">Use this video in mine</option>
                        <option value="swap">Remake this video with another person</option>
                        <option value="example">Only a model: copy its pace and shots</option>
                      </>
                    : <>
                        <option value="person">This person presents or appears in the video</option>
                        <option value="as_is">Show this picture exactly as it is</option>
                      </>}
                </select>
                <button type="button" onClick={() => { setFiles(prev => prev.filter((_, j) => j !== i)); setUses(({ [fileId(f)]: _gone, ...rest }) => rest); }}
                  className="text-slate-400 hover:text-red-600">remove</button>
              </li>
            ))}
          </ul>
        )}
      </Field>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        {staged
          ? "Next step: a free script (about 2 minutes): the kind of video we chose, every shot with its words, and the estimated cost."
          : "Next step: a free storyboard (about 2 minutes) with the kind of video we chose, the script and the estimated cost."}
        {" "}You can ask for any change there, including a different kind of video.
        {keyframeReview
          ? " Then you approve an image of every shot. Nothing is produced and no budget is used until you approve them."
          : " Nothing is produced and no budget is used until you approve it."}
        {hearPrice > 0 && ` The one exception is listening to your ${hearPrice > HEAR_USD ? "clips" : "clip"} ($${hearPrice.toFixed(2)}), which you confirm when you send this.`}
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {confirm && (
        <PayDialog title="Listen to your clips and write the script" price={hearPrice} spend={spend}
          onCancel={() => setConfirm(null)} onConfirm={() => void send(confirm, true)} />
      )}

      <button
        disabled={!!busy}
        className="rounded-md bg-electric px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ?? `Request ${word}`}
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
