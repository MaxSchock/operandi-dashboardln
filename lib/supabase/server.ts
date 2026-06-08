import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to the user's auth cookies.
 * Reads from the `outreach` schema — RLS enforces tenant isolation.
 *
 * For admin overrides (write to outreach.* with operandi_admin checks),
 * use `serviceRoleClient()` instead; it bypasses RLS via the service key.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(items) {
          try {
            items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot mutate cookies; safely ignored.
          }
        },
      },
      db: { schema: "outreach" },
    },
  );
}

/**
 * Service-role client. ONLY use in app/api routes after asserting
 * `current_user_is_admin`. Never expose to client components.
 */
export function serviceRoleClient() {
  // Lazy import to avoid bundling
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
