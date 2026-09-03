import { NextResponse } from "next/server";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";

/** Who is acting. operandi_admin may act on any client; client_operator only on its own. */
export async function resolveActor() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "auth required" }, { status: 401 }) };
  const { data: cu } = await sb.from("client_users")
    .select("role,email,client_slug").eq("user_id", user.id).maybeSingle();
  const isAdmin = cu?.role === "operandi_admin";
  const isOperator = cu?.role === "client_operator";
  if (!isAdmin && !isOperator) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return {
    user,
    isAdmin,
    isOperator,
    clientSlug: (cu?.client_slug as string | null) ?? null,
    actor: (cu?.email ?? user.email ?? "operandi_admin") as string,
  };
}

/** Tenant check for operators: the lead must belong to their client. Returns the lead_state row. */
export async function loadLeadForActor(leadId: number, actor: { isAdmin: boolean; clientSlug: string | null }) {
  const admin = serviceRoleClient().schema("outreach");
  const { data: state } = await admin.from("lead_state")
    .select("lead_id, client_slug, current_stage, channel_state")
    .eq("lead_id", leadId).maybeSingle();
  if (!state) return null;
  if (!actor.isAdmin && state.client_slug !== actor.clientSlug) return null;
  return state as { lead_id: number; client_slug: string; current_stage: string; channel_state: Record<string, unknown> };
}

/** POST to the strategist with the shared webhook token. Never throws; returns status + body text. */
export async function strategist(path: string, opts: { json?: unknown; query?: Record<string, string> } = {}) {
  const base = process.env.STRATEGIST_BASE_URL;
  const token = process.env.STRATEGIST_WEBHOOK_TOKEN;
  if (!base) return { ok: false, status: 500, text: "STRATEGIST_BASE_URL not set" };
  const url = new URL(`${base.replace(/\/$/, "")}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        ...(token ? { "x-webhook-token": token } : {}),
        ...(opts.json !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 502, text: `strategist unreachable: ${String(e)}` };
  }
}

/** Pull the machine reason out of the strategist's FastAPI 409 body ({"detail": "..."}). */
export function reasonOf(text: string): string {
  try {
    const d = JSON.parse(text)?.detail;
    if (typeof d === "string" && d) return d.slice(0, 160);
  } catch { /* not JSON */ }
  return text.slice(0, 160) || "refused";
}

export function backTo(req: Request, fallback = "/calling"): URL {
  return new URL(req.headers.get("referer") ?? fallback, req.url);
}

/** Products the caller's client has actually contracted. Admins pass through.
 *
 *  Ownership ("is this row mine?") was checked everywhere; entitlement ("do I have this
 *  product?") was not, so an operator whose client never bought outreach could still
 *  approve emails, fire invitations or upload contacts on their own data (Codex audit,
 *  2026-09-03). Missing feature rows keep the historical behaviour: allowed. */
export async function requireFeature(
  actor: { isAdmin: boolean; clientSlug: string | null },
  feature: "has_outreach" | "has_engagement" | "has_content",
): Promise<NextResponse | null> {
  if (actor.isAdmin) return null;
  if (!actor.clientSlug) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const admin = serviceRoleClient().schema("outreach");
  const { data, error } = await admin.from("client_features")
    .select("has_outreach, has_engagement, has_content")
    .eq("client_slug", actor.clientSlug).maybeSingle();
  // A read failure must not open the door: fail closed.
  if (error) return NextResponse.json({ error: "could not verify entitlements" }, { status: 503 });
  if (!data) return null;
  const on = (data as Record<string, boolean | null>)[feature];
  if (on === false) return NextResponse.json({ error: "product not enabled for this client" }, { status: 403 });
  return null;
}

/** True when a write actually changed a row. Supabase returns error=null for an update
 *  whose filters matched nothing, and reporting that as success is how an operator ends
 *  up believing something was saved when it was not. */
export function changedNothing(res: { error: unknown; data: unknown[] | null }): boolean {
  return !res.error && (!res.data || res.data.length === 0);
}
