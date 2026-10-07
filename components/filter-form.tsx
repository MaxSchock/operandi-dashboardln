"use client";

import { useTransition, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A search or filter form: the same address a plain GET form would produce,
 * reached as a soft navigation, so the list is redrawn and the document is not
 * loaded again (Max, 2026-10-07).
 */
export function FilterForm({ action, className, children }: { action?: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [drawing, startDrawing] = useTransition();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pressed = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(e.currentTarget)) if (typeof v === "string") q.append(k, v);
    if (pressed?.name) q.set(pressed.name, pressed.value);
    startDrawing(() => router.push(`${action ?? path}?${q}`, { scroll: false }));
  }
  return (
    <form onSubmit={submit} className={className} aria-busy={drawing}>
      {children}
      {drawing && (
        <span role="status" aria-live="polite" data-testid="working" className="inline-flex items-center gap-1 text-[11px] text-amber-700">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />Searching...
        </span>
      )}
    </form>
  );
}
