// Tells a Supabase outage apart from a missing or invalid session.
// A user whose session check failed because Supabase could not be reached is not
// signed out: sending them to /login hides the outage and looks like a logout.

type MaybeAuthError = { name?: unknown; status?: unknown } | null | undefined;

/** True when the error means "could not ask Supabase", not "no valid session". */
export function isAuthOutage(error: MaybeAuthError): boolean {
  if (!error) return false;
  // auth-js raises this for fetch failures and for 502/503/504/52x/530.
  if (error.name === "AuthRetryableFetchError") return true;
  const status = typeof error.status === "number" ? error.status : undefined;
  return status !== undefined && (status === 0 || status >= 500);
}
