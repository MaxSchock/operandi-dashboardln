"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Option = { slug: string; label: string };

export function ClientScopeSelector({
  options,
  current,
}: {
  options: Option[];
  current: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    await fetch("/api/scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: value }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="px-3 py-2 border-b bg-slate-50">
      <label className="block text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-1">
        Tenant scope
      </label>
      <select
        defaultValue={current}
        onChange={onChange}
        disabled={pending}
        className="w-full rounded-md border bg-white px-2 py-1.5 text-sm"
      >
        <option value="all">All clients</option>
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
