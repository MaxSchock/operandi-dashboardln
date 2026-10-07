"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Close a request (it leaves the list), or, for an admin, reopen a closed one to the state it had. */
export function VideoClose({ id, closed, isAdmin }: { id: string; closed: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (closed && !isAdmin) return null;
  const send = async (action: "close" | "reopen") => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/videos/${id}/close`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? `did not work (${res.status})`); return; }
      setAsking(false);
      if (action === "close") router.push("/videos"); else router.refresh();
    } finally { setBusy(false); }
  };
  const btn = "rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-xs text-slate-500" data-testid="video-close">
      {closed
        ? <button type="button" disabled={busy} className={`${btn} text-slate-700`} data-testid="video-reopen" onClick={() => void send("reopen")}>Reopen</button>
        : asking
          ? <>
              <span>Close this request? It leaves your list; nothing more is produced or charged for it.</span>
              <button type="button" disabled={busy} className={`${btn} border-slate-700 bg-slate-700 text-white`} data-testid="video-close-confirm" onClick={() => void send("close")}>Yes, close it</button>
              <button type="button" disabled={busy} className={`${btn} text-slate-600`} onClick={() => setAsking(false)}>Keep it open</button>
            </>
          : <button type="button" className={`${btn} text-slate-600`} data-testid="video-close-ask" onClick={() => setAsking(true)}>Close request</button>}
      {error && <span className="text-red-600" data-testid="video-close-error">{error}</span>}
    </div>
  );
}
