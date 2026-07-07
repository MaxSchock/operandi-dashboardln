"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const TRANSIENT = new Set([
  "storyboard_pending", "storyboard_approved", "queued", "rendering", "edit_requested", "recomposing",
]);

/** Refreshes the server-rendered detail page while the request is in a
 * transient state, so the client never has to hit reload manually. */
export function VideoStatusPoller({ status }: { status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!TRANSIENT.has(status)) return;
    const id = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(id);
  }, [status, router]);
  return null;
}
