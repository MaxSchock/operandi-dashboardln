"use client";

import { useRef, useState, type ReactNode } from "react";

export type MonthSpend = { cap_usd: number; spent_usd: number; pending_usd: number };

const usd = (v: number) => `$${v.toFixed(2)}`;

/** Nothing that costs money starts without this: the price of the step and
 * what the account has already used of its monthly budget. */
export function PayDialog({ title, price, about, spend, busy, onConfirm, onCancel }: {
  title: string; price: number | null; about?: boolean; spend: MonthSpend | null; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const used = spend ? spend.spent_usd + spend.pending_usd : 0;
  const over = !!spend && price !== null && used + price > spend.cap_usd + 0.001;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h4 className="font-display text-base text-navy">{title}</h4>
        <p className="mt-3 text-sm text-slate-700">
          This step costs <strong data-testid="pay-price">{price === null ? "an amount set by the engine" : `${about ? "about " : ""}${usd(price)}`}</strong>.
        </p>
        {spend && (
          <p className="mt-1 text-xs text-slate-500" data-testid="pay-month">
            This month: {usd(used)} of {usd(spend.cap_usd)} used{price !== null ? `, ${usd(Math.max(0, spend.cap_usd - used - price))} left after this step` : ""}.
          </p>
        )}
        {over && <p className="mt-2 text-xs text-red-600">This passes the monthly budget of the account, so it will not start.</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy || over} data-testid="pay-confirm"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">
            {busy ? "Starting..." : "Confirm and start"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A plain form whose submit costs money: it only posts after the confirmation. */
export function PaidForm({ action, title, price, about, spend, free, className, children }: {
  /** This submit costs nothing (same button, cheaper path): post straight away. */
  free?: boolean; action: string; title: string; price: number | null; about?: boolean; spend: MonthSpend | null; className?: string; children: ReactNode;
}) {
  const form = useRef<HTMLFormElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form ref={form} action={action} method="post" className={className}
      onSubmit={e => { if (!busy && !free) { e.preventDefault(); if (form.current?.reportValidity()) setOpen(true); } }}>
      {children}
      {open && <PayDialog title={title} price={price} about={about} spend={spend} busy={busy}
        onCancel={() => setOpen(false)} onConfirm={() => { setBusy(true); form.current?.submit(); }} />}
    </form>
  );
}
