import { redirect } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Users, Inbox, Sparkles, FileText, Activity, Settings, LogOut, Shield, MessageSquare, CalendarDays, Lock, Clapperboard, Share2 } from "lucide-react";
import { createClient, createPublicClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { PostHogIdentify } from "@/components/posthog-init";
import { ClientScopeSelector } from "@/components/client-scope-selector";
import { MobileNav, type MobileNavItem } from "@/components/mobile-nav";
import { AutoRefresh } from "@/components/auto-refresh";
import { getClientScope } from "@/lib/scope";
import { getTier } from "@/lib/tier";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  // From here `user` is non-null; the redirect above terminates the request,
  // but TypeScript's `redirect` return type isn't `never` until Next 15+, so
  // re-bind to a non-nullable local.
  const u = user;

  const tier = await getTier();
  const cu = tier.userId
    ? { role: tier.role, client_slug: tier.clientSlug, display_name: tier.displayName, email: tier.email }
    : null;

  const isAdmin = tier.isAdmin;
  const scope = await getClientScope();

  // Admins can switch between any v2 outreach client plus content-only clients
  // (rows whose content_engine_slug is set). Non-admins are pinned to their
  // own slug (RLS will reject anything else anyway). clients_master lives in
  // the public schema, so use a public-schema client here.
  const sbPublic = await createPublicClient();
  const { data: clientRows } = isAdmin
    ? await sbPublic.from("clients_master")
        .select("client_slug, client_display_name")
        .or("outreach_engine.eq.v2,content_engine_slug.not.is.null")
        .eq("active", true)
        .order("client_slug")
    : { data: [] as { client_slug: string; client_display_name: string | null }[] };
  const scopeOptions = (clientRows ?? []).map(r => ({
    slug: r.client_slug,
    label: r.client_display_name || r.client_slug,
  }));

  const tenantLabel = scope
    ? (scopeOptions.find(o => o.slug === scope)?.label ?? scope)
    : (isAdmin ? "All clients" : (cu?.client_slug ?? "—"));

  // Locked items stay visible (they render an upsell page); hidden items are
  // simply absent for content-only clients. Server guards on each page are the
  // real enforcement; this only shapes the nav.
  const locked = !tier.hasOutreach;
  const nav = [
    { href: "/dashboard", label: "Overview",  icon: LayoutDashboard, key: "dashboard",  show: true,  locked: false },
    { href: "/leads",     label: "Leads",     icon: Users,           key: "leads",      show: true,  locked },
    { href: "/engagement", label: "Warm DMs", icon: MessageSquare,   key: "engagement", show: true,  locked },
    { href: "/content",   label: "Content",   icon: CalendarDays,    key: "content",    show: true,  locked: false },
    { href: "/distribution", label: "Distribution", icon: Share2,     key: "distribution", show: isAdmin, locked: false },
    { href: "/videos",    label: "Videos",    icon: Clapperboard,    key: "videos",     show: tier.videoEnabled, locked: false },
    { href: "/activity",  label: "Activity",  icon: Activity,        key: "activity",   show: tier.hasOutreach, locked: false },
    { href: "/templates", label: "Templates", icon: FileText,        key: "templates",  show: tier.hasOutreach, locked: false },
    { href: "/admin",     label: "Admin",     icon: Shield,          key: "admin",      show: isAdmin, locked: false },
    { href: "/admin/bandit",  label: "Bandit health", icon: Sparkles, key: "bandit",    show: isAdmin, locked: false },
    { href: "/admin/health",  label: "System health", icon: Inbox,   key: "health",     show: isAdmin, locked: false },
  ].filter(n => n.show);

  // Serializable copy for the client-side mobile drawer (icons resolved there).
  const mobileItems: MobileNavItem[] = nav.map(n => ({
    href: n.href, label: n.label, icon: n.key as MobileNavItem["icon"], locked: n.locked,
  }));

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="hidden md:flex md:w-60 flex-col border-r bg-white">
        <div className="flex h-16 items-center gap-2 border-b px-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-white font-display text-sm">O</div>
          <div>
            <div className="text-sm font-medium leading-tight">Operandi</div>
            <div className="text-xs text-slate-500 leading-tight">{tenantLabel}</div>
          </div>
        </div>
        {isAdmin && (
          <ClientScopeSelector options={scopeOptions} current={scope ?? "all"} />
        )}
        <nav className="flex-1 space-y-0.5 p-3">
          {nav.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <item.icon className="h-4 w-4 text-slate-500" />
              <span>{item.label}</span>
              {item.locked && <Lock className="ml-auto h-3 w-3 text-slate-400" />}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3 text-xs">
          <div className="mb-2 truncate text-slate-600" title={cu?.email ?? u.email ?? ""}>
            {cu?.display_name ?? u.email}
          </div>
          <SignOutButton />
          {process.env.NEXT_PUBLIC_POSTHOG_KEY && (
            <p className="mt-2 text-[10px] leading-4 text-slate-400">
              We collect anonymized usage analytics and session data (inputs masked) to improve the product.
            </p>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <PostHogIdentify email={cu?.email ?? u.email ?? null} clientSlug={cu?.client_slug ?? null} role={cu?.role ?? null} />
        <AutoRefresh intervalMs={30000} />
        <MobileNav
          items={mobileItems}
          tenantLabel={tenantLabel}
          isAdmin={isAdmin}
          scopeOptions={scopeOptions}
          currentScope={scope ?? "all"}
          userLabel={cu?.display_name ?? u.email ?? ""}
        />
        <div className="mx-auto max-w-7xl p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
