"use client";

import { useState } from "react";

/** Copies a text to the clipboard; used for comment reply drafts the client posts by hand. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          // clipboard blocked: the text stays selectable on the card
        }
      }}
      className="rounded-md border px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {done ? "Copied" : label}
    </button>
  );
}
