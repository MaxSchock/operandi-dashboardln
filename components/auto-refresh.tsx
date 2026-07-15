"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the current page for fresh server data every `intervalMs` ms by
 * calling router.refresh(). Cheap because all (app)/* pages are already
 * marked dynamic with revalidate=0, so the refresh just re-runs the
 * Server Component fetch. No client state is reset.
 *
 * Pauses while the tab is hidden to avoid burning fetches when nobody's
 * looking and to keep mobile from waking the radio.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    // Skip the refresh while the user is mid-edit: typing in a field or having
    // an expanded <details> form open. A refresh re-renders the server payload
    // and the post list may have re-ordered or re-numbered underneath (the
    // process daemon deletes suspended sheet rows and shifts the rest), which
    // yanked the card away while clients were editing (Cardeleine, 2026-07-15).
    const userIsEditing = () => {
      const el = document.activeElement;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT")) return true;
      return document.querySelector("details[open]") != null;
    };
    const start = () => {
      if (id != null) return;
      id = setInterval(() => { if (!userIsEditing()) router.refresh(); }, intervalMs);
    };
    const stop = () => {
      if (id != null) { clearInterval(id); id = null; }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [router, intervalMs]);
  return null;
}
