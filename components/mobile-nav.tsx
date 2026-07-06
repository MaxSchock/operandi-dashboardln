"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Inbox, Sparkles, FileText, Activity,
  Shield, MessageSquare, CalendarDays, Menu, X, Lock, Clapperboard,
} from "lucide-react";
import { ClientScopeSelector } from "@/components/client-scope-selector";
import { SignOutButton } from "@/components/sign-out-button";

const ICONS = {
  dashboard: LayoutDashboard,
  leads: Users,
  engagement: MessageSquare,
  content: CalendarDays,
  videos: Clapperboard,
  activity: Activity,
  templates: FileText,
  admin: Shield,
  bandit: Sparkles,
  health: Inbox,
} as const;

export type MobileNavItem = { href: string; label: string; icon: keyof typeof ICONS; locked?: boolean };

/**
 * Mobile-only navigation. Renders a top bar with a hamburger that opens a
 * slide-in drawer holding the same links as the desktop sidebar (which is
 * hidden below `md`). Without this, mobile users have no way to navigate.
 */
export function MobileNav({
  items,
  tenantLabel,
  isAdmin,
  scopeOptions,
  currentScope,
  userLabel,
}: {
  items: MobileNavItem[];
  tenantLabel: string;
  isAdmin: boolean;
  scopeOptions: { slug: string; label: string }[];
  currentScope: string;
  userLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="md:hidden">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white px-4">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-white font-display text-sm">O</div>
          <div className="leading-tight">
            <div className="text-sm font-medium">Operandi</div>
            <div className="text-[11px] text-slate-500">{tenantLabel}</div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-lg border text-slate-700 hover:bg-slate-100"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Drawer + overlay */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <div className="text-sm font-medium">Menu</div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-lg border text-slate-700 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {isAdmin && (
              <ClientScopeSelector options={scopeOptions} current={currentScope} />
            )}

            <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                      active ? "bg-slate-100 font-medium text-navy" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="h-4 w-4 text-slate-500" />
                    <span>{item.label}</span>
                    {item.locked && <Lock className="ml-auto h-3 w-3 text-slate-400" />}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t p-3 text-xs">
              <div className="mb-2 truncate text-slate-600">{userLabel}</div>
              <SignOutButton />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
