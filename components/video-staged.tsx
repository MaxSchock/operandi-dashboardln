"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";
import { PayDialog, type MonthSpend } from "@/components/video-pay";
import { ChangeMarker } from "@/components/video-change-marker";
import { shotsInOrder, whoMissing, CLIP_MAX_S, LANG_NAMES, TEXT_MAX_CHARS, isTextBoard, type Board, type Job, type Join, type Montage, type Region, type ShotEdit, type StagedShot } from "@/lib/video-staged";

type Image = { id: string; n: number; role: "start" | "end"; version: number; status: string; notes: string | null; carried: boolean; url: string };
type TakeView = {
  id: string; n: number; version: number; status: string; notes: string | null; duration_s: number; voice_end_s: number | null;
  first_last: boolean; lips: { where: string | null; done: boolean; reason: string | null; dub?: string | null; dub_failed?: string | null } | null; url: string; frames: string[]; checks: string[];
};
export type StagedData = {
  id: string; status: string; isAdmin: boolean; error: string | null; held: boolean;
  board: Board | null; montage: Montage; spend: MonthSpend | null;
  images: Image[]; takes: TakeView[]; clips: Record<string, string>; jobs: Job[]; versions: { version: number; url: string }[];
  changes: { id: string; shot_n: number | null; target: string; note: string | null; region: Region | null; status: string; actor: string; created_at: string }[];
};

const usd = (v: number) => `$${v.toFixed(2)}`;
const KIND_LABEL: Record<string, string> = { persona: "A person speaks", pantalla: "Speaks from a phone screen", silent: "No one speaks", ceo: "Presenter speaks", clip: "Your own clip", text: "Text on screen" };
const JOIN_LABEL: Record<Join, string> = { cut: "Hard cut", dissolve: "Dissolve", fadewhite: "Fade through white", fadeblack: "Fade through black" };
const JOB_LABEL: Record<string, string> = {
  script_propose: "Writing the shots", script_apply: "Updating the shots", image_draw: "Drawing a picture", shot_film: "Filming a shot",
  captions_stt: "Timing the captions", music: "Composing the music", assemble: "Assembling the video",
};
const ORDER = ["draft", "script_pending", "script_ready", "script_approved", "images_approved", "shots_ready", "assembling", "delivered"];
const btn = "rounded-md px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40";
const input = "w-full rounded-md border bg-white px-2 py-1 text-xs";

type Ask = { title: string; price: number; body: Record<string, unknown> };
type Mark = { title: string; src: string; price: number; body: Record<string, unknown>; needNote: boolean; needRegion?: boolean };

export function VideoStaged({ data }: { data: StagedData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [mark, setMark] = useState<Mark | null>(null);
  const { board, status } = data;
  const active = data.jobs.filter(j => j.status === "queued" || j.status === "running");
  const waiting = active.length > 0 || status === "script_pending" || status === "assembling";

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [waiting, router]);

  async function call(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/videos/${data.id}/staged`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? `failed (${res.status})`); return false; }
      router.refresh();
      return true;
    } catch {
      setError("No connection. Try again in a moment."); return false;
    } finally { setBusy(false); }
  }
  // A step that costs nothing (a stretch of the client's own clip, cut as it is) starts at once.
  const pay = (title: string, price: number, body: Record<string, unknown>) => {
    if (price > 0) setAsk({ title, price, body }); else void call({ ...body, confirmed_usd: 0 });
  };
  const jobOf = (kind: string, n?: number, role?: string) =>
    active.find(j => j.kind === kind && (n === undefined || j.shot_n === n) && (role === undefined || j.role === role));
  const failed = data.jobs.filter(j => j.status === "failed").slice(0, 3);
  const stage = ORDER.indexOf(status);

  return (
    <div className="space-y-6" data-testid="staged" data-status={status}>
      {data.spend && (
        <p className="text-xs text-slate-500" data-testid="month-spend">
          Production budget this month: {usd(data.spend.spent_usd + data.spend.pending_usd)} of {usd(data.spend.cap_usd)} used.
          Every step that costs money shows its price and waits for your confirmation.
        </p>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="staged-error">{error}</div>}
      {active.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="staged-working">
          {active.map(j => `${JOB_LABEL[j.kind] ?? j.kind}${j.shot_n ? ` (shot ${shotLabel(board, j.shot_n)})` : ""}`).join(" · ")}. This page refreshes itself.
        </div>
      )}
      {failed.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {failed.map(j => <div key={j.id}>{JOB_LABEL[j.kind] ?? j.kind}{j.shot_n ? ` (shot ${shotLabel(board, j.shot_n)})` : ""} did not work: {j.error ?? "unknown reason"}</div>)}
        </div>
      )}
      {!board && <Card><CardBody><p className="text-sm text-slate-600">The shots are being written. This takes about a minute.</p></CardBody></Card>}

      {board && status === "script_ready" && <Script key={JSON.stringify(board.shots) + JSON.stringify(board.proposals) + JSON.stringify(board.clip_people ?? {})} board={board} clips={data.clips} busy={busy || !!jobOf("script_apply")} call={call} />}
      {board && stage > 2 && <ScriptSummary board={board} />}
      {board && stage >= 3 && Object.entries(board.clip_people ?? {}).filter(([ref, cp]) => cp.people.length > 1
        && board.shots.some(s => s.kind === "clip" && s.recipe === "swap" && s.source_ref === ref)).map(([ref, cp]) => (
        <Card key={ref}><CardBody className={`space-y-1 text-xs ${cp.who == null ? "bg-amber-50" : ""}`}>
          <div className="font-medium text-slate-700" data-testid="clip-who-late">{cp.people.length} people appear in your clip {fileName(ref)}. Who is replaced?{cp.who == null ? " Choose before the person is put into the clip." : ""}</div>
          {cp.people.map((p, k) => (
            <label key={k} className="flex items-center gap-2 text-slate-700">
              <input type="radio" name={`who-late-${ref}`} checked={cp.who === k} disabled={busy} onChange={() => call({ action: "clip_who", clip: ref, who: k })} />
              {p}</label>
          ))}
        </CardBody></Card>
      ))}
      {board && stage >= 3 && <Images data={data} board={board} busy={busy} call={call} pay={pay} setMark={setMark} jobOf={jobOf} />}
      {board && stage >= 4 && <Shots data={data} board={board} busy={busy} call={call} pay={pay} setMark={setMark} jobOf={jobOf} />}
      {board && stage >= 5 && <MontagePanel key={JSON.stringify(data.montage)} data={data} board={board} busy={busy || status === "assembling" || !!jobOf("assemble")} call={call} pay={pay} jobOf={jobOf} />}

      {data.isAdmin && data.changes.length > 0 && (
        <Card>
          <CardHeader title="Change requests" hint="Admin only: everything that was asked to change, newest first." />
          <CardBody className="space-y-1 text-xs text-slate-600">
            {data.changes.map(c => (
              <div key={c.id} className="flex flex-wrap gap-2">
                <Badge tone={c.status === "applied" ? "green" : c.status === "open" ? "amber" : "slate"}>{c.status}</Badge>
                <span>shot {shotLabel(board, c.shot_n)} · {c.target.replace("_", " ")}{c.region ? " · marked area" : ""} · {c.actor}</span>
                <span className="text-slate-500">{c.note}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {ask && <PayDialog title={ask.title} price={ask.price} spend={data.spend} busy={busy} onCancel={() => setAsk(null)}
        onConfirm={async () => { await call({ ...ask.body, confirmed_usd: ask.price }); setAsk(null); }} />}
      {mark && <MarkDialog mark={mark} spend={data.spend} busy={busy} onCancel={() => setMark(null)}
        onConfirm={async extra => { if (await call({ ...mark.body, ...extra, confirmed_usd: mark.price })) setMark(null); }} />}
    </div>
  );
}

function shotLabel(board: Board | null, n: number | null): string {
  if (n === null || !board) return String(n ?? "");
  const i = board.order.indexOf(n);
  return i === -1 ? String(n) : String(i + 1);
}

type Common = {
  busy: boolean; call: (b: Record<string, unknown>) => Promise<boolean>;
  pay: (title: string, price: number, body: Record<string, unknown>) => void;
  jobOf: (kind: string, n?: number, role?: string) => Job | undefined;
};

/** Note (and optional marked area) for a new version, with its price. */
function MarkDialog({ mark, spend, busy, onConfirm, onCancel }: {
  mark: Mark; spend: MonthSpend | null; busy: boolean; onConfirm: (extra: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [region, setRegion] = useState<Region | null>(null);
  const [note, setNote] = useState("");
  const used = spend ? spend.spent_usd + spend.pending_usd : 0;
  const ready = (!mark.needNote || note.trim().length >= 3) && (!mark.needRegion || !!region);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-navy/40 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-xl">
        <h4 className="font-display text-base text-navy">{mark.title}</h4>
        <ChangeMarker src={mark.src} region={region} onChange={setRegion} />
        {mark.needNote && (
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} data-testid="mark-note"
            placeholder="What should be different? One clear instruction." className="w-full rounded-md border bg-white p-2 text-xs leading-5" />
        )}
        <p className="text-xs text-slate-600">
          This costs <strong data-testid="pay-price">{usd(mark.price)}</strong>.
          {spend && ` This month: ${usd(used)} of ${usd(spend.cap_usd)} used.`} The version you have now is kept.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={`${btn} border text-slate-600`}>Cancel</button>
          <button type="button" disabled={busy || !ready} data-testid="mark-confirm" onClick={() => onConfirm({ note: note.trim(), region })}
            className={`${btn} bg-emerald-600 text-white`}>{busy ? "Starting..." : "Confirm and start"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- stage 0: the shot table ---------- */

type Row = ShotEdit & { key: string; text_by?: string; locked?: boolean; duration_s?: number; clip?: string | null; how?: string | null; from?: string; to?: string; dub_lang?: string };

/** A stretch of the client's clip: the player shows that part only. */
function ClipStretch({ src, from, to }: { src?: string; from: number; to: number }) {
  if (!src || !(to > from)) return null;
  return <video key={`${from}-${to}`} src={`${src}#t=${from.toFixed(2)},${to.toFixed(2)}`} controls playsInline preload="metadata"
    className="w-28 rounded-md border bg-black" data-testid="clip-stretch" />;
}

/** Uploaded files carry an id in front of their name; the person knows them by the name. */
const fileName = (name?: string | null) => (name ?? "").replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, "");

function clipWords(s: StagedShot): string {
  return s.recipe === "swap"
    ? `with ${s.person_ref ? `the person of ${fileName(s.person_ref)}` : s.character || "another person"} in the place of the person in it`
    : "as it is";
}

function Script({ board, clips, busy, call }: { board: Board; clips: Record<string, string>; busy: boolean; call: Common["call"] }) {
  const [rows, setRows] = useState<Row[]>(() => shotsInOrder(board).map(s => ({
    key: `s${s.n}`, n: s.n, kind: s.kind, text: s.text, speaker: s.speaker, camera: s.camera ?? "", link: s.link,
    lips_where: s.lips?.where ?? (s.kind === "pantalla" ? "phone" : "face"), narration: s.narration ?? "", to_phone: !!s.to_phone,
    text_by: s.text_by, locked: s.kind === "clip", duration_s: s.duration_s,
    ...(s.kind === "clip" ? { clip: s.source_ref, how: clipWords(s), from: String(s.source_start_s ?? 0),
      to: String(s.source_end_s ?? Math.round(((s.source_start_s ?? 0) + s.duration_s) * 100) / 100),
      ...(s.dub ? { dub_lang: s.dub.lang, dub_text: s.dub.text, dub_off: false } : {}) } : {}),
  })));
  const [decisions, setDecisions] = useState<Record<string, string>>(() => Object.fromEntries(board.proposals.map(p => [p.id, p.status])));
  const [endText, setEndText] = useState(board.end_card?.text ?? "");
  // Clips whose person is replaced and that show several people: the client says who.
  const several = Object.entries(board.clip_people ?? {}).filter(([ref, cp]) => cp.people.length > 1
    && board.shots.some(s => s.kind === "clip" && s.recipe === "swap" && s.source_ref === ref));
  const [who, setWho] = useState<Record<string, number | null>>(() => Object.fromEntries(several.map(([ref, cp]) => [ref, cp.who])));
  const unanswered = whoMissing(board, who);
  const added = useRef(0);
  const set = (i: number, patch: Partial<Row>) => setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const move = (i: number, d: number) => setRows(r => {
    const j = i + d; if (j < 0 || j >= r.length) return r;
    const c = [...r]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  const total = useMemo(() => {
    const shots = Object.values(board.costs.shots).reduce((a, c) => a + c.film + c.lips + c.voice, 0);
    return (board.needs?.length ?? 0) * board.costs.image + shots + board.costs.music + board.costs.captions;
  }, [board]);
  const send = (approve: boolean) => call({
    action: "script_save", approve, end_text: endText, proposals: decisions, clip_who: who,
    shots: rows.map(({ key: _k, text_by: _t, locked: _l, duration_s: _d, clip: _c, how: _h, dub_lang: _g, from, to, ...e }) =>
      _l ? { ...e, from_s: Number(from), to_s: Number(to) } : e),
  });
  const open = board.proposals.filter(p => !p.applied);

  return (
    <Card>
      <CardHeader title="1 · Script, shot by shot" hint="Your words stay as you wrote them. Change any field, then save: lengths and prices are worked out again. Nothing here costs money." />
      <CardBody className="space-y-4">
        {open.length > 0 && (
          <div className="space-y-2" data-testid="proposals">
            <div className="text-xs font-medium text-slate-700">Suggestions</div>
            {open.map(p => (
              <div key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 text-xs" data-testid={`proposal-${p.id}`}>
                <span className="max-w-xl text-slate-700">{p.shot_n ? `Shot ${shotLabel(board, p.shot_n)}: ` : ""}{p.text}</span>
                <span className="flex gap-1">
                  {(["accepted", "rejected"] as const).map(v => (
                    <button key={v} type="button" onClick={() => setDecisions(d => ({ ...d, [p.id]: d[p.id] === v ? "open" : v }))}
                      className={`${btn} border ${decisions[p.id] === v ? (v === "accepted" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-600 bg-slate-600 text-white") : "text-slate-600"}`}>
                      {v === "accepted" ? "Accept" : "Reject"}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        {several.map(([ref, cp]) => (
          <div key={ref} className={`space-y-1 rounded-md border px-3 py-2 text-xs ${who[ref] == null ? "border-amber-300 bg-amber-50" : ""}`} data-testid="clip-who">
            <div className="font-medium text-slate-700">{cp.people.length} people appear in your clip {fileName(ref)}. Who is replaced?</div>
            {cp.people.map((p, k) => (
              <label key={k} className="flex items-center gap-2 text-slate-700">
                <input type="radio" name={`who-${ref}`} checked={who[ref] === k} onChange={() => setWho(w => ({ ...w, [ref]: k }))} data-testid={`clip-who-${k}`} />
                {p}</label>
            ))}
          </div>
        ))}
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.key} className="rounded-md border p-3" data-testid="shot-row">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-navy">Shot {i + 1}{r.duration_s ? ` · ${r.duration_s.toFixed(1)}s` : " · new"}
                  {r.n !== null && board.costs.shots[String(r.n)] ? ` · ${usd(Object.values(board.costs.shots[String(r.n)]).reduce((a, b) => a + b, 0))}` : ""}</span>
                <span className="flex gap-1">
                  <button type="button" className={`${btn} border`} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button type="button" className={`${btn} border`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button type="button" className={`${btn} border text-red-600`} disabled={rows.length === 1} onClick={() => setRows(x => x.filter((_, j) => j !== i))}>Remove</button>
                </span>
              </div>
              {r.locked ? (
                <div className="flex flex-wrap items-start gap-3 text-xs text-slate-600" data-testid="clip-row">
                  <ClipStretch src={r.clip ? clips[r.clip] : undefined} from={Number(r.from)} to={Number(r.to)} />
                  <div className="max-w-md space-y-2">
                    <p>Your clip {fileName(r.clip)}, {r.how}. {r.dub_lang && !r.dub_off ? `Said in ${LANG_NAMES[r.dub_lang] ?? r.dub_lang} by a new voice, with the lips moved to it.` : "It keeps its own sound."}</p>
                    <p className="text-slate-500">{r.text_by === "clip" ? "Said in this part: " : ""}{r.text}</p>
                    {r.dub_lang && (
                      <div className="space-y-1" data-testid="clip-dub">
                        {!r.dub_off && <label className="block text-[11px] text-slate-500">In {LANG_NAMES[r.dub_lang] ?? r.dub_lang} (it has to fit into the same seconds; empty it to have it translated again)
                          <textarea rows={2} value={r.dub_text ?? ""} onChange={e => set(i, { dub_text: e.target.value })} className={`${input} block w-full`} data-testid="clip-dub-text" /></label>}
                        <label className="flex items-center gap-1 text-[11px] text-slate-500">
                          <input type="checkbox" checked={!!r.dub_off} onChange={e => set(i, { dub_off: e.target.checked })} data-testid="clip-dub-off" />
                          Keep the original voice in this shot</label>
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-[11px] text-slate-500">From second
                        <input type="number" min={0} step={0.1} value={r.from ?? ""} onChange={e => set(i, { from: e.target.value })} className={`${input} block`} style={{ width: "5rem" }} data-testid="clip-from" /></label>
                      <label className="text-[11px] text-slate-500">to second
                        <input type="number" min={0} step={0.1} value={r.to ?? ""} onChange={e => set(i, { to: e.target.value })} className={`${input} block`} style={{ width: "5rem" }} data-testid="clip-to" /></label>
                      <span className="pb-1 text-[11px] text-slate-400">{Number(r.to) - Number(r.from) > CLIP_MAX_S ? `One shot holds ${CLIP_MAX_S} seconds at most.` : "Save to read the words of the new part."}</span>
                    </div>
                  </div>
                </div>
              ) : r.kind === "text" ? (
                <label className="block text-[11px] text-slate-500">Text on screen{r.text_by === "agent" ? " (suggested, not yours)" : ""}
                  <textarea rows={2} maxLength={TEXT_MAX_CHARS} value={r.text ?? ""} onChange={e => set(i, { text: e.target.value })} className={`${input} leading-5`} data-testid="shot-text" />
                </label>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-[11px] text-slate-500 sm:col-span-2">{r.kind === "silent" ? "What happens" : "Words"}{r.text_by === "agent" ? " (suggested, not yours)" : r.text_by === "clip" ? " (heard in your clip)" : ""}
                    <textarea rows={2} value={r.text ?? ""} onChange={e => set(i, { text: e.target.value })} className={`${input} leading-5`} data-testid="shot-text" />
                  </label>
                  <label className="text-[11px] text-slate-500">Kind
                    <select value={r.kind} onChange={e => set(i, { kind: e.target.value, lips_where: e.target.value === "pantalla" ? "phone" : "face" })} className={input}>
                      {["persona", "pantalla", "silent", "ceo"].map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </label>
                  {r.kind !== "silent"
                    ? <label className="text-[11px] text-slate-500">Who speaks<input value={r.speaker ?? ""} onChange={e => set(i, { speaker: e.target.value })} className={input} /></label>
                    : <label className="text-[11px] text-slate-500">Voice-over (optional)<input value={r.narration ?? ""} onChange={e => set(i, { narration: e.target.value })} className={input} /></label>}
                  <label className="text-[11px] text-slate-500">Camera<input value={r.camera ?? ""} onChange={e => set(i, { camera: e.target.value })} placeholder="chosen for you if empty" className={input} /></label>
                  <label className="text-[11px] text-slate-500">Joins the shot before
                    <select value={r.link} disabled={i === 0} onChange={e => set(i, { link: e.target.value })} className={input}>
                      <option value="cut">New picture (cut)</option>
                      <option value="continuity">Continues where it ended</option>
                    </select>
                  </label>
                  {r.kind !== "silent" && (
                    <label className="text-[11px] text-slate-500">Lips move on
                      <select value={r.lips_where} onChange={e => set(i, { lips_where: e.target.value })} className={input}>
                        <option value="face">The face of the person</option>
                        <option value="phone">The face on the phone screen</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          ))}
          <button type="button" className={`${btn} border text-slate-600`} disabled={rows.length >= 12}
            onClick={() => setRows(r => [...r, { key: `new${added.current++}`, n: null, kind: isTextBoard(board) ? "text" : "persona", text: "", speaker: "", camera: "", link: "cut", lips_where: "face", narration: "" }])}>
            Add a shot
          </button>
        </div>
        <label className="block text-[11px] text-slate-500">Text on the closing card (empty: no closing card)
          <textarea rows={2} value={endText} onChange={e => setEndText(e.target.value)} className={`${input} leading-5`} data-testid="end-text" />
        </label>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <button type="button" disabled={busy} onClick={() => send(false)} className={`${btn} border text-slate-700`} data-testid="script-save">Save changes</button>
          <button type="button" disabled={busy || unanswered.length > 0} title={unanswered.length ? "First choose who in your clip is replaced" : undefined} onClick={() => send(true)} className={`${btn} bg-emerald-600 text-white disabled:opacity-50`} data-testid="script-approve">Save and approve script</button>
          {unanswered.length > 0 && <span className="text-[11px] text-amber-700">Choose above who in your clip is replaced.</span>}
          <span className="text-[11px] text-slate-400">Free. With this table the whole video comes to about {usd(total)}, paid step by step.</span>
        </div>
      </CardBody>
    </Card>
  );
}

function ScriptSummary({ board }: { board: Board }) {
  return (
    <details className="rounded-2xl border bg-white px-5 py-3 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium">Script ({board.order.length} shots, approved)</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {shotsInOrder(board).map(s => <li key={s.n}>{s.speaker ? `${s.speaker}: ` : ""}{s.text} <span className="text-slate-400">({KIND_LABEL[s.kind]}, {s.duration_s.toFixed(1)}s)</span></li>)}
      </ol>
      {board.end_card?.text && <p className="mt-2">Closing card: {board.end_card.text}</p>}
    </details>
  );
}

/* ---------- stage 1: pictures ---------- */

function Images({ data, board, busy, call, pay, setMark, jobOf }: Common & { data: StagedData; board: Board; setMark: (m: Mark) => void }) {
  const price = board.costs.image;
  const shots = shotsInOrder(board);
  const need = new Set((board.needs ?? []).map(x => `${x.n}:${x.role}`));
  const missing = (board.needs ?? []).filter(x => !data.images.some(i => i.n === x.n && i.role === x.role && i.status === "approved"));
  return (
    <Card>
      <CardHeader title="2 · Pictures" hint={isTextBoard(board) ? "This video is text on a plain background: there is nothing to draw. Approve to go on." : `Each shot starts on a picture; some also end on one. ${usd(price)} per picture. A new version needs a note saying what to change, and earlier versions stay available.`} />
      <CardBody className="space-y-5">
        {shots.map(s => {
          const roles = (["start", "end"] as const).filter(role => need.has(`${s.n}:${role}`) || data.images.some(i => i.n === s.n && i.role === role));
          const hasStart = data.images.some(i => i.n === s.n && i.role === "start" && i.status === "approved");
          return (
            <div key={s.n} className="space-y-2 border-b pb-4 last:border-0" data-testid={`images-shot-${s.n}`}>
              <div className="text-xs font-medium text-navy">Shot {shotLabel(board, s.n)} <span className="font-normal text-slate-500">{s.speaker ? `${s.speaker}: ` : ""}{s.text}</span></div>
              {s.kind === "clip" && (
                <div className="flex flex-wrap items-start gap-3">
                  <ClipStretch src={s.source_ref ? data.clips[s.source_ref] : undefined} from={s.source_start_s ?? 0} to={s.source_end_s ?? (s.source_start_s ?? 0) + s.duration_s} />
                  <p className="max-w-sm text-[11px] text-slate-400">
                    {s.recipe !== "swap" ? "This part of your clip goes into the video as it is: there is nothing to draw."
                      : roles.length ? "This part of your clip, with the person below in the place of the person in it."
                      : `The same person as in shot ${shotLabel(board, s.person_from ?? s.n)}: that picture is used here too.`}
                  </p>
                </div>
              )}
              {s.kind === "text" && <p className="text-[11px] text-slate-400">Text on a plain background: there is nothing to draw.</p>}
              {s.kind !== "clip" && s.kind !== "text" && roles.length === 0 && <p className="text-[11px] text-slate-400">Continues from the last frame of the shot before: no picture of its own.</p>}
              {roles.map(role => {
                const list = data.images.filter(i => i.n === s.n && i.role === role);
                const job = jobOf("image_draw", s.n, role);
                const current = list.find(i => i.status === "approved") ?? list[0];
                return (
                  <div key={role} className="space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">{s.kind === "clip" ? "The person who goes into your clip" : role === "start" ? "First picture" : "Last picture"}</div>
                    <div className="flex flex-wrap gap-3">
                      {list.map(i => (
                        <figure key={i.id} className="w-32 space-y-1 text-[11px]" data-testid={`image-${s.n}-${role}-v${i.version}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <a href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt="" className={`w-32 rounded-md border-2 ${i.status === "approved" ? "border-emerald-500" : "border-transparent"}`} /></a>
                          <figcaption className="text-slate-500">v{i.version}{i.carried ? " · from the shot before" : ""}{i.status === "approved" ? " · approved" : ""}</figcaption>
                          {i.notes && <div className="text-slate-400">{i.notes}</div>}
                          {i.status !== "approved" && <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="image-pick"
                            onClick={() => call({ action: "image_pick", keyframe: i.id })}>Use this one</button>}
                        </figure>
                      ))}
                    </div>
                    {job ? <p className="text-[11px] text-amber-700">Being drawn...</p>
                      : !current ? <button type="button" disabled={busy} className={`${btn} bg-navy text-white`} data-testid="image-draw"
                          onClick={() => pay(s.kind === "clip" ? `Draw the person for shot ${shotLabel(board, s.n)}` : `Draw the ${role === "start" ? "first" : "last"} picture of shot ${shotLabel(board, s.n)}`, price, { action: "draw", shot: s.n, role })}>Draw this picture ({usd(price)})</button>
                      : !current.carried && <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="image-change"
                          onClick={() => setMark({ title: `Change the ${role === "start" ? "first" : "last"} picture of shot ${shotLabel(board, s.n)} (from v${current.version})`, src: current.url, price, needNote: true,
                            body: { action: "draw", shot: s.n, role, base_version: current.version } })}>Change something ({usd(price)})</button>}
                  </div>
                );
              })}
              {s.kind !== "clip" && hasStart && !roles.includes("end") && !jobOf("image_draw", s.n, "end") && (
                <button type="button" disabled={busy} className="text-[11px] text-slate-500 underline"
                  onClick={() => pay(`Draw a last picture for shot ${shotLabel(board, s.n)}`, price, { action: "draw", shot: s.n, role: "end" })}>
                  Add a last picture, so the shot ends exactly there ({usd(price)})
                </button>
              )}
            </div>
          );
        })}
        {data.status === "script_approved" && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || missing.length > 0} className={`${btn} bg-emerald-600 text-white`} data-testid="images-approve"
              onClick={() => call({ action: "images_approve" })}>Pictures are right, go on to filming</button>
            <span className="text-[11px] text-slate-400">{missing.length ? `Still to approve: ${missing.map(x => `shot ${shotLabel(board, x.n)} (${x.role === "start" ? "first" : "last"})`).join(", ")}.` : "Free. Each shot is filmed and paid one by one afterwards."}</span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ---------- stage 2: shots ---------- */

function Shots({ data, board, busy, call, pay, setMark, jobOf }: Common & { data: StagedData; board: Board; setMark: (m: Mark) => void }) {
  const shots = shotsInOrder(board);
  const priceOf = (n: number) => { const c = board.costs.shots[String(n)] ?? { film: 0, lips: 0, voice: 0 }; return Math.round((c.film + c.lips + c.voice) * 100) / 100; };
  const todo = shots.filter(s => !data.takes.some(t => t.n === s.n && t.status !== "stale") && !jobOf("shot_film", s.n));
  const [filmingAll, setFilmingAll] = useState(false);
  return (
    <Card>
      <CardHeader title="3 · Shots" hint="Each shot is filmed on its own. Watch it, approve it, or film it again with a note: pause where something is wrong and mark it." />
      <CardBody className="space-y-5">
        {data.isAdmin && todo.length > 1 && (
          <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="film-all" onClick={() => setFilmingAll(true)}>
            Film the {todo.length} shots without a take ({usd(todo.reduce((a, s) => a + priceOf(s.n), 0))})
          </button>
        )}
        {shots.map(s => <ShotCard key={s.n} s={s} data={data} board={board} busy={busy} call={call} pay={pay} setMark={setMark} jobOf={jobOf} price={priceOf(s.n)} />)}
        {filmingAll && <PayDialog title={`Film ${todo.length} shots`} price={todo.reduce((a, s) => a + priceOf(s.n), 0)} spend={data.spend} busy={busy}
          onCancel={() => setFilmingAll(false)}
          onConfirm={async () => { for (const s of todo) { if (!await call({ action: "film", shot: s.n, confirmed_usd: priceOf(s.n) })) break; } setFilmingAll(false); }} />}
      </CardBody>
    </Card>
  );
}

function ShotCard({ s, data, board, busy, call, pay, setMark, jobOf, price }: Common & { s: StagedShot; data: StagedData; board: Board; setMark: (m: Mark) => void; price: number }) {
  const list = data.takes.filter(t => t.n === s.n);
  const [sel, setSel] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const take = list.find(t => t.id === sel) ?? list.find(t => t.status === "approved") ?? list.find(t => t.status !== "stale") ?? list[0];
  const job = jobOf("shot_film", s.n);
  const lipsPrice = Math.round((board.costs.shots[String(s.n)]?.lips ?? 0) * 100) / 100;
  const frameAt = () => {
    const t = video.current?.currentTime ?? 0;
    video.current?.pause();
    const frames = take?.frames ?? [];
    return { frame_s: Math.round(t * 100) / 100, src: frames[Math.min(frames.length - 1, Math.floor(t * 2))] };
  };
  const label = shotLabel(board, s.n);
  const isClip = s.kind === "clip", swap = isClip && s.recipe === "swap", isText = s.kind === "text";
  const dubbed = isClip && !!s.dub?.text;
  const dubLang = dubbed ? LANG_NAMES[s.dub!.lang] ?? s.dub!.lang : "";
  const dubPrice = Math.round(((board.costs.shots[String(s.n)]?.lips ?? 0) + (board.costs.shots[String(s.n)]?.voice ?? 0)) * 100) / 100;
  return (
    <div className="space-y-2 border-b pb-4 last:border-0" data-testid={`shot-${s.n}`}>
      <div className="text-xs font-medium text-navy">Shot {label} <span className="font-normal text-slate-500">{s.speaker ? `${s.speaker}: ` : ""}{dubbed ? s.dub!.text : s.text}</span></div>
      {take && (
        <div className="flex flex-wrap items-start gap-4">
          <video ref={video} key={take.id} src={take.url} controls playsInline preload="metadata" className="w-44 rounded-md border bg-black" />
          <div className="max-w-sm space-y-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap gap-1">
              {list.map(t => (
                <button key={t.id} type="button" onClick={() => setSel(t.id)}
                  className={`rounded border px-2 py-0.5 ${t.id === take.id ? "border-navy text-navy" : "text-slate-500"}`}>
                  take {t.version}{t.status === "approved" ? " ✓" : t.status === "stale" ? " (old picture)" : ""}
                </button>
              ))}
            </div>
            <div>{take.duration_s.toFixed(1)}s{take.notes ? ` · ${take.notes}` : ""}</div>
            {take.lips && !take.lips.done && take.status !== "stale" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
                The lips were not moved: the face that speaks could not be found safely{take.lips.reason ? ` (${take.lips.reason})` : ""}. Nothing was charged for them.
                {take.frames.length > 0 && <button type="button" disabled={busy || !!job} className="ml-1 underline" data-testid="lips-mark"
                  onClick={() => { const f = frameAt(); setMark({ title: `Shot ${label}: mark the face that speaks`, src: f.src, price: lipsPrice, needNote: false, needRegion: true, body: { action: "film", shot: s.n, what: "lips", frame_s: f.frame_s } }); }}>
                  Mark the face ({usd(lipsPrice)})</button>}
              </div>
            )}
            {dubbed && take.lips?.dub_failed && take.status !== "stale" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800" data-testid="dub-failed">
                This take still has the original voice: the {dubLang} voice could not be made ({take.lips.dub_failed}).
                {swap && !job && <button type="button" disabled={busy} className="ml-1 underline" data-testid="take-dub"
                  onClick={() => pay(`Say shot ${label} in ${dubLang}`, dubPrice, { action: "film", shot: s.n, what: "dub" })}>
                  Make the voice ({usd(dubPrice)})</button>}
              </div>
            )}
            {take.checks.length > 0 && <div className="flex gap-1">{take.checks.map(c => <a key={c} href={c} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c} alt="lips check" className="h-16 rounded border" /></a>)}</div>}
            {take.status !== "stale" && (
              <div className="flex flex-wrap gap-2">
                {take.status !== "approved" && <button type="button" disabled={busy} className={`${btn} bg-emerald-600 text-white`} data-testid="take-pick"
                  onClick={() => call({ action: "take_pick", take: take.id })}>Approve this take</button>}
                {isClip && !swap && dubbed && !job && <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="take-redub"
                  onClick={() => pay(`Say shot ${label} in ${dubLang} again`, price, { action: "film", shot: s.n })}>
                  Make it again ({usd(price)})</button>}
                {swap && !job && <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="take-reswap"
                  onClick={() => pay(`Put the person into shot ${label} again`, price, { action: "film", shot: s.n })}>
                  Make it again ({usd(price)})</button>}
                {!isClip && !isText && take.frames.length > 0 && !job && <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="take-refilm"
                  onClick={() => { const f = frameAt(); setMark({ title: `Film shot ${label} again (paused at ${f.frame_s.toFixed(1)}s)`, src: f.src, price, needNote: true, body: { action: "film", shot: s.n, frame_s: f.frame_s } }); }}>
                  Film again with a note ({usd(price)})</button>}
              </div>
            )}
          </div>
        </div>
      )}
      {job ? <p className="text-[11px] text-amber-700">{swap ? "The person is being put into your clip. This takes 10 to 20 minutes." : dubbed ? `Being cut from your clip and said in ${dubLang}. This takes a few minutes.` : isClip ? "Being cut from your clip." : isText ? "The text card is being made." : "Being filmed. A shot takes 3 to 15 minutes."}</p>
        : (!take || list.every(t => t.status === "stale")) && (
          <button type="button" disabled={busy} className={`${btn} bg-navy text-white`} data-testid="shot-film"
            onClick={() => pay(swap ? `Put the person into shot ${label}` : `Film shot ${label}`, price, { action: "film", shot: s.n, ...(list.length ? { note: "Filmed again from the picture approved now." } : {}) })}>
            {swap ? `Put the person into this part of your clip${dubbed ? ` and say it in ${dubLang}` : ""} (${usd(price)})` : dubbed ? `Cut this part and say it in ${dubLang} (${usd(price)})` : isClip ? "Cut this part from your clip (free)" : isText ? "Make this text card (free)" : `Film this shot (${usd(price)})`}</button>
        )}
    </div>
  );
}

/* ---------- stage 3: montage ---------- */

function MontagePanel({ data, board, busy, call, pay, jobOf }: Common & { data: StagedData; board: Board }) {
  const m = data.montage;
  const shots = shotsInOrder(board);
  const hasEnd = !!(board.end_card?.text || board.end_card?.url);
  const pairs = shots.map((s, i) => {
    const next = shots[i + 1];
    return next ? { name: `${s.n}>${next.n}`, def: (next.link === "continuity" ? "cut" : "dissolve") as Join }
      : { name: `${s.n}>end`, def: "fadewhite" as Join };
  });
  const [joins, setJoins] = useState<Record<string, Join>>(m.joins ?? {});
  const [trims, setTrims] = useState<Record<string, string>>(Object.fromEntries(Object.entries(m.trims ?? {}).map(([k, v]) => [k, String(v)])));
  const [musicOn, setMusicOn] = useState(m.music?.on !== false);
  const [under, setUnder] = useState(String(m.music?.under_voice ?? 0.09));
  const [endLevel, setEndLevel] = useState(String(m.music?.end_card ?? 0.25));
  const [capsOn, setCapsOn] = useState(m.captions?.on !== false);
  const [caps, setCaps] = useState(m.captions?.shots ?? {});
  const [endText, setEndText] = useState(board.end_card?.text ?? "");
  const [endSecs, setEndSecs] = useState(m.end_card?.seconds ? String(m.end_card.seconds) : "");
  const [prompt, setPrompt] = useState("");
  const approved = (n: number) => data.takes.find(t => t.n === n && t.status === "approved");
  const maxTrim = (n: number) => { const t = approved(n); return t ? Math.max(0, t.duration_s - ((t.voice_end_s ?? 0.7) + 0.3)) : 0; };
  const body = () => ({
    end_text: endText,
    montage: {
      joins, music: { on: musicOn, under_voice: Number(under), end_card: Number(endLevel) },
      trims: Object.fromEntries(Object.entries(trims).filter(([, v]) => v !== "").map(([k, v]) => [k, Math.min(Number(v), maxTrim(Number(k)))])),
      captions: { on: capsOn, shots: caps }, ...(endSecs ? { end_card: { seconds: Number(endSecs) } } : {}),
    },
  });
  const timed = shots.filter(s => s.audio !== "none").every(s => m.captions?.shots?.[String(s.n)]?.source);
  const latest = data.versions[0];

  return (
    <Card>
      <CardHeader title="4 · Montage" hint="Order, joins, music and captions. Assembling is free and as often as you like: every time gives a new version and the earlier ones stay." />
      <CardBody className="space-y-5">
        {latest && (
          <div className="flex flex-wrap items-start gap-4" data-testid="deliverable">
            <video key={latest.url} src={latest.url} controls playsInline preload="metadata" className="w-56 rounded-md border bg-black" />
            <div className="space-y-1 text-xs text-slate-600">
              <div className="font-medium text-navy">Version {latest.version}{data.held ? " (held by the final check)" : ""}</div>
              <a href={latest.url} className="underline" download>Download</a>
              {data.versions.slice(1).map(v => <div key={v.version}><a href={v.url} target="_blank" rel="noreferrer" className="text-slate-500 underline">Version {v.version}</a></div>)}
            </div>
          </div>
        )}
        <div className="flex gap-3 overflow-x-auto pb-2" data-testid="timeline">
          {shots.map((s, i) => {
            const t = approved(s.n);
            const piece = m.timeline?.find(p => p.n === s.n);
            return (
              <div key={s.n} className="flex shrink-0 items-start gap-3">
                <div className="w-32 space-y-1 text-[11px] text-slate-500">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {t?.frames[0] ? <img src={t.frames[0]} alt="" className="w-32 rounded-md border" /> : <div className="grid h-24 w-32 place-items-center rounded-md border text-slate-400">shot {i + 1}</div>}
                  <div>Shot {i + 1} · {(piece?.length_s ?? t?.duration_s ?? s.duration_s).toFixed(1)}s</div>
                  {t && maxTrim(s.n) >= 0.1 && (
                    <label className="block">Cut from the end (max {maxTrim(s.n).toFixed(1)}s)
                      <input type="number" min={0} max={maxTrim(s.n)} step={0.1} value={trims[String(s.n)] ?? ""} placeholder="automatic"
                        onChange={e => setTrims(x => ({ ...x, [String(s.n)]: e.target.value }))} className={input} data-testid={`trim-${s.n}`} />
                    </label>
                  )}
                </div>
                {(i < shots.length - 1 || hasEnd || !!endText.trim()) && (
                  <select value={joins[pairs[i].name] ?? pairs[i].def} onChange={e => setJoins(j => ({ ...j, [pairs[i].name]: e.target.value as Join }))}
                    className="rounded-md border bg-white px-1 py-1 text-[11px]" data-testid={`join-${pairs[i].name}`}>
                    {(Object.keys(JOIN_LABEL) as Join[]).map(j => <option key={j} value={j}>{JOIN_LABEL[j]}</option>)}
                  </select>
                )}
              </div>
            );
          })}
          <div className="w-40 shrink-0 space-y-1 text-[11px] text-slate-500">
            <label className="block">Closing card text
              <textarea rows={3} value={endText} onChange={e => setEndText(e.target.value)} className={`${input} leading-5`} data-testid="montage-end-text" />
            </label>
            <label className="block">Seconds on screen
              <input type="number" min={1.5} max={10} step={0.5} value={endSecs} placeholder="automatic" onChange={e => setEndSecs(e.target.value)} className={input} />
            </label>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 text-xs text-slate-600">
            <label className="flex items-center gap-2 font-medium text-slate-700"><input type="checkbox" checked={musicOn} onChange={e => setMusicOn(e.target.checked)} /> Music</label>
            <p className="text-[11px] text-slate-400">{m.music?.key ? "A track is ready." : "No track yet: the video is assembled without music until one is composed."}</p>
            <div className="flex gap-2">
              <label className="text-[11px] text-slate-500">Level under the voices<input type="number" min={0} max={0.5} step={0.01} value={under} onChange={e => setUnder(e.target.value)} className={input} /></label>
              <label className="text-[11px] text-slate-500">Level on the closing card<input type="number" min={0} max={0.8} step={0.01} value={endLevel} onChange={e => setEndLevel(e.target.value)} className={input} /></label>
            </div>
            <input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="What the music should feel like (optional)" className={input} />
            {jobOf("music") ? <p className="text-[11px] text-amber-700">Being composed...</p>
              : <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="music-new"
                  onClick={() => pay(m.music?.key ? "Compose another music track" : "Compose the music", board.costs.music, { action: "music", prompt })}>
                  {m.music?.key ? "Compose another track" : "Compose the music"} ({usd(board.costs.music)})</button>}
          </div>
          <div className="space-y-2 text-xs text-slate-600">
            <label className="flex items-center gap-2 font-medium text-slate-700"><input type="checkbox" checked={capsOn} onChange={e => setCapsOn(e.target.checked)} /> Captions</label>
            <p className="text-[11px] text-slate-400">{timed ? "Timed to the voices. Change any wording below." : "Until they are timed to the voices, captions follow the script text spread evenly over each shot."}</p>
            {jobOf("captions_stt") ? <p className="text-[11px] text-amber-700">Being timed...</p>
              : !timed && <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="captions-time"
                  onClick={() => pay("Time the captions to the voices", board.costs.captions, { action: "captions" })}>Time them to the voices ({usd(board.costs.captions)})</button>}
            {shots.map((s, i) => (caps[String(s.n)]?.blocks ?? []).map((b, k) => (
              <input key={`${s.n}-${k}`} value={b.text} className={input} data-testid="caption-block" aria-label={`Caption ${k + 1} of shot ${i + 1}`}
                onChange={e => setCaps(c => ({ ...c, [String(s.n)]: { ...c[String(s.n)], blocks: (c[String(s.n)].blocks ?? []).map((x, j) => j === k ? { ...x, text: e.target.value } : x) } }))} />
            )))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <button type="button" disabled={busy} className={`${btn} bg-emerald-600 text-white`} data-testid="assemble"
            onClick={() => call({ action: "assemble", ...body() })}>{latest ? "Assemble again" : "Assemble the video"}</button>
          <button type="button" disabled={busy} className={`${btn} border text-slate-700`} data-testid="montage-save" onClick={() => call({ action: "montage_save", ...body() })}>Save without assembling</button>
          <span className="text-[11px] text-slate-400">{data.status === "assembling" ? "Being assembled, about two minutes." : "Free."}</span>
        </div>
      </CardBody>
    </Card>
  );
}
