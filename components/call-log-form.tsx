"use client";

import { useEffect, useState } from "react";
import { NURTURE_BRANCHES, OUTCOME_LABEL } from "@/lib/calling";

/** `datetime-local` value (no zone) for a Date, in the browser's own time. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function at(daysAhead: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function nextMonday(hour: number): Date {
  const d = at(1, hour);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

/** Converts what the operator picked (their own clock) to an ISO instant. The server
 *  used to read the bare datetime-local value as UTC, so a UK callback in summer rang
 *  an hour late and a Spanish one two. */
function toIso(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Remembers the browser's time zone for the server, which decides what "today" means. */
export function TimeZoneCookie() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && !document.cookie.includes(`tz=${encodeURIComponent(tz)}`)) {
        document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      }
    } catch { /* no Intl: the server falls back to Europe/London */ }
  }, []);
  return null;
}

export function CallLogForm({
  leadId, email, emailConsent, branches = NURTURE_BRANCHES as unknown as { key: string; label: string }[],
  hint = "What they said: can they take more work? what is the bottleneck? who decides?",
}: {
  leadId: number;
  email: string | null;
  emailConsent: boolean;
  branches?: { key: string; label: string }[];
  hint?: string;
}) {
  const [outcome, setOutcome] = useState<string>("no_answer");
  const [callback, setCallback] = useState("");
  const [meeting, setMeeting] = useState("");
  const shortcuts: [string, () => Date][] = [
    ["in 2 h", () => { const d = new Date(Date.now() + 2 * 3600_000); d.setMinutes(0, 0, 0); return d; }],
    ["tomorrow 10:00", () => at(1, 10)],
    ["in 3 days", () => at(3, 10)],
    ["next week", () => nextMonday(10)],
  ];
  return (
    <form action={`/api/calling/outcome/${leadId}`} method="post" className="mt-3 space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {(["no_answer", "red", "orange", "green"] as const).map(o => (
          <label key={o} className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 ${outcome === o ? "border-electric bg-electric/5" : ""}`}>
            <input type="radio" name="outcome" value={o} required checked={outcome === o} onChange={() => setOutcome(o)} />
            <span>{OUTCOME_LABEL[o]}</span>
          </label>
        ))}
      </div>
      <textarea name="notes" rows={2} placeholder={hint}
        className="w-full rounded-md border bg-slate-50 p-2 text-xs leading-5 text-slate-700" />

      {(outcome === "orange" || outcome === "green") && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1">email
            <input type="email" name="email" defaultValue={email ?? ""} placeholder="ask: where can I send it?"
              className="w-64 rounded-md border px-2 py-1 text-xs" />
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" name="email_consent" defaultChecked={emailConsent} /> they said yes to an email
          </label>
        </div>
      )}

      {outcome === "orange" && branches.length > 1 && (
        <label className="flex items-center gap-1 text-xs">they are:
          <select name="branch" className="rounded-md border px-2 py-1 text-xs" defaultValue="generic">
            {branches.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>
      )}

      {outcome === "green" && (
        <label className="flex items-center gap-1 text-xs">meeting on
          <input type="datetime-local" value={meeting} onChange={e => setMeeting(e.target.value)} className="rounded-md border px-2 py-1 text-xs" />
          <input type="hidden" name="meeting_at" value={toIso(meeting)} />
        </label>
      )}

      {outcome !== "red" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">call back</span>
          {shortcuts.map(([label, fn]) => (
            <button key={label} type="button" onClick={() => setCallback(localInput(fn()))}
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200">{label}</button>
          ))}
          <input type="datetime-local" value={callback} onChange={e => setCallback(e.target.value)} className="rounded-md border px-2 py-1 text-xs" />
          {callback && <button type="button" onClick={() => setCallback("")} className="text-slate-400 hover:text-slate-600">clear</button>}
          <input type="hidden" name="callback_at" value={toIso(callback)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-2 text-xs">
        {outcome !== "red" && <label className="flex items-center gap-1"><input type="checkbox" name="linkedin_connect" /> connect on LinkedIn</label>}
        <button className="ml-auto rounded-md bg-electric px-3 py-1 text-xs font-medium text-white hover:opacity-90">Save call</button>
      </div>
    </form>
  );
}
