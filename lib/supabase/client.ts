import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * Notes:
 *  - `flowType: 'pkce'` is explicit even though it's the default in
 *    @supabase/ssr ≥ 0.5. Belt + braces: if we ever pin an older
 *    version this stays correct, and it makes the contract obvious
 *    to anyone reading the callback handler.
 *  - We do NOT set `db: { schema: 'outreach' }` here. Auth has its own
 *    schema and we don't query application tables from the browser.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "pkce",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    },
  );
}
