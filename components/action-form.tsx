"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { noticeText } from "@/lib/calling";

/**
 * A form of the dashboard: it posts with fetch, turns a wheel while the action
 * runs, shows what went wrong (or what was done) on its own card and then asks
 * the server for this page's data once, so only what changed is redrawn. The
 * page is never loaded again and the browser stays where it is (Max, 2026-10-07).
 * The route answers through lib/form-answer.ts.
 *
 * A button may carry `formAction` to post somewhere else, and `name`/`value`.
 * A notice the route answers with is shown under the form, in the words of `said`.
 */
export function ActionForm({ action, className, children, reset, working = "Saving...", done, said, confirm, testid }: {
  action: string; className?: string; children: ReactNode;
  /** Empty the fields after a success (a note, a file). */
  reset?: boolean;
  working?: string;
  /** Shown under the form after a success that brings no notice of its own. */
  done?: string;
  said?: Record<string, string>;
  /** Asked before posting. */
  confirm?: string;
  testid?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [drawing, startDrawing] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    if (confirm && !window.confirm(confirm)) return;
    const pressed = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const body = new FormData(form);
    if (pressed?.name) body.set(pressed.name, pressed.value);
    const url = pressed?.getAttribute("formaction") || action;
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { accept: "application/json" }, body });
      const d = await res.json().catch(() => ({})) as { error?: string; to?: string; notice?: string | null };
      if (!res.ok) { setError(String(d.error ?? `failed (${res.status})`)); return; }
      if (reset) form.reset();
      setNote(d.notice ? noticeText(d.notice, said) : done ?? null);
      const here = `${path}${search.size ? `?${search}` : ""}`;
      // This page as it is, this page with what the route added to its address (a
      // notice), or the page the action leads to: none of them loads the document again.
      startDrawing(() => {
        if (!d.to || d.to === here) router.refresh();
        else if (d.to.split("?")[0] === path) router.replace(d.to, { scroll: false });
        else router.push(d.to);
      });
    } catch {
      setError("No connection. Try again in a moment.");
    } finally { setBusy(false); }
  }

  const on = busy || drawing;
  return (
    <form onSubmit={submit} className={className} data-testid={testid} aria-busy={on}>
      <fieldset disabled={on} className="contents">{children}</fieldset>
      {on && (
        <span role="status" aria-live="polite" data-testid="working" className="inline-flex items-center gap-1 text-[11px] text-amber-700">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />{working}
        </span>
      )}
      {!on && error && <span role="alert" data-testid="form-error" className="block basis-full text-[11px] text-red-700">That didn&apos;t work: {error}</span>}
      {!on && !error && note && <span role="status" data-testid="form-done" className="block basis-full text-[11px] text-emerald-700">{note}</span>}
    </form>
  );
}
