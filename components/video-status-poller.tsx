"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

const TRANSIENT: Record<string, string> = {
  storyboard_pending: "The script is being written.",
  storyboard_approved: "Production is starting.",
  keyframes_generating: "The images are being drawn.",
  queued: "In production.",
  rendering: "In production.",
  edit_requested: "Your edit is being applied.",
  recomposing: "Your edit is being applied.",
  redo_requested: "The scene is being made again.",
  redoing: "The scene is being made again.",
};

/** While the request is being worked on: a turning wheel saying what is being
 * made, and a light question to the server every few seconds. The page is
 * drawn again once, when the answer changes; it is not refreshed on a timer
 * (Max, 2026-10-07). */
export function VideoStatusPoller({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const mark = useRef<string | null>(null);
  const working = status in TRANSIENT;
  useEffect(() => {
    if (!working) return;
    let gone = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/videos/${id}/status`, { cache: "no-store" });
        if (!res.ok || gone) return;
        const d = await res.json() as { mark: string };
        if (gone) return;
        if (mark.current !== null && mark.current !== d.mark) router.refresh();
        mark.current = d.mark;
      } catch { /* the next tick asks again */ }
    };
    void tick();
    const t = setInterval(tick, 8000);
    return () => { gone = true; clearInterval(t); };
  }, [working, id, status, router]);
  if (!working) return null;
  return (
    <div role="status" aria-live="polite" data-testid="working" className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      <span>{TRANSIENT[status]} The result appears on this page by itself.</span>
    </div>
  );
}
