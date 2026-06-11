import { redirect } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Users, Inbox, Sparkles, FileText, Activity, Settings, LogOut, Shield } from "lucide-react";
import { createClient, createPublicClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { ClientScopeSelector } from "@/components/client-scope-selector";
import { AutoRefresh } from "@/components/auto-refresh";
import { getClientScope } from "@/lib/scope";

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

  const { data: cu } = await sb
    .from("client_users")
    .select("role, client_slug, display_name, email")
    .eq("user_id", u.id)
    .maybeSingle();

  const isAdmin = cu?.role === "operandi_admin";
  const scope = await getClientScope();

  // Admins can switch between any v2 client; non-admins are pinned to their
  // own slug (RLS will reject anything else anyway). clients_master lives in
  // the public schema, so use a public-schema client here.
  const sbPublic = await createPublicClient();
  const { data: clientRows } = isAdmin
    ? await sbPublic.from("clients_master")
        .select("client_slug, client_display_name")
        .eq("outreach_engine", "v2")
        .order("client_slug")
    : { data: [] as { client_slug: string; client_display_name: string | null }[] };
  const scopeOptions = (clientRows ?? []).map(r => ({
    slug: r.client_slug,
    label: r.client_display_name || r.client_slug,
  }));

  const tenantLabel = scope
    ? (scopeOptions.find(o => o.slug === scope)?.label ?? scope)
    : (isAdmin ? "All clients" : (cu?.client_slug ?? "—"));

  const nav = [
    { href: "/dashboard", label: "Overview",  icon: LayoutDashboard, show: true },
    { href: "/leads",     label: "Leads",     icon: Users,           show: true },
    { href: "/activity",  label: "Activity",  icon: Activity,        show: true },
    { href: "/templates", label: "Templates", icon: FileText,        show: true },
    { href: "/admin",     label: "Admin",     icon: Shield,          show: isAdmin },
    { href: "/admin/bandit",  label: "Bandit health", icon: Sparkles, show: isAdmin },
    { href: "/admin/health",  label: "System health", icon: Inbox,    show: isAdmin },
  ].filter(n => n.show);

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
            </Link>
          ))}
        </nav>
        <div className="border-t p-3 text-xs">
          <div className="mb-2 truncate text-slate-600" title={cu?.email ?? u.email ?? ""}>
            {cu?.display_name ?? u.email}
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <AutoRefresh intervalMs={30000} />
        <div className="mx-auto max-w-7xl p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
