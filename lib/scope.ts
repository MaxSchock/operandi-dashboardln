import { cookies } from "next/headers";

/**
 * Global client scope. Stored in the `operandi_scope` cookie, read on every
 * server render. The sidebar selector writes it via /api/scope.
 *
 * Returns:
 *   - null  → "All clients" (no filter)
 *   - slug  → only data for that client_slug
 */
export async function getClientScope(): Promise<string | null> {
  const c = await cookies();
  const v = c.get("operandi_scope")?.value;
  if (!v || v === "all") return null;
  return v;
}

/**
 * Convenience wrapper for Supabase query builders. Use as:
 *
 *   const scope = await getClientScope();
 *   let qb = sb.from("lead_state").select("*");
 *   qb = applyScope(qb, scope);
 */
export function applyScope<T extends { eq: (col: string, val: string) => T }>(qb: T, scope: string | null): T {
  return scope ? qb.eq("client_slug", scope) : qb;
}
