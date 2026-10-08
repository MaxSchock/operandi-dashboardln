"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Keeps a screen current without a timer that redraws it: every `everyMs` it
 * asks GET /api/pulse for a short mark of the data behind the screen and calls
 * router.refresh() once, only when the mark differs from the last one. Screens
 * that keep themselves up to date (Content, a video's page) get `mark: null`
 * and are left alone.
 *
 * Does not ask while the tab is hidden, and holds a pending redraw while the
 * user is mid-edit (typing in a field or with a <details> form open): a redraw
 * may re-order the list underneath (Cardeleine, 2026-07-15).
 */
export function PageWatch({ everyMs = 30_000 }: { everyMs?: number }) {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    let last: string | null | undefined;
    let off = false;
    let id: ReturnType<typeof setInterval> | null = null;
    const editing = () => {
      const el = document.activeElement;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT")) return true;
      return document.querySelector("details[open]") != null;
    };
    const ask = async () => {
      if (editing()) return;
      try {
        const r = await fetch(`/api/pulse?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        if (!r.ok || off) return;
        const { mark } = (await r.json()) as { mark: string | null };
        if (mark == null) { stop(); return; }
        if (last !== undefined && mark !== last) router.refresh();
        last = mark;
      } catch { /* offline: the next round asks again */ }
    };
    const start = () => { if (id == null) { void ask(); id = setInterval(ask, everyMs); } };
    const stop = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      off = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [router, path, everyMs]);
  return null;
}
