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
    const start = () => {
      if (id != null) return;
      id = setInterval(() => router.refresh(), intervalMs);
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
