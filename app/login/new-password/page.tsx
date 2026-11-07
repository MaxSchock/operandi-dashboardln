import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { pickLang } from "@/lib/login-i18n";
import { NewPasswordForm } from "./new-password-form";

export const dynamic = "force-dynamic";

/**
 * Reached from the reset link: the callback has already opened a session with the
 * recovery code. Without a session (expired or reused link) the person goes back to
 * the sign-in screen with a message.
 */
export default async function NewPasswordPage() {
  const sb = await createClient();
  const { data: { user }, error } = await sb.auth.getUser();
  // No session means the link expired or was used; any other failure is the provider's
  // and surfaces as an error page instead of a misleading "link expired".
  if (error && error.name !== "AuthSessionMissingError") throw error;
  if (!user) redirect("/login?error=link_expired");
  const lang = pickLang(headers().get("accept-language"));

  return (
    <main lang={lang} className="flex min-h-screen items-center justify-center p-6">
      <NewPasswordForm lang={lang} email={user.email ?? ""} />
    </main>
  );
}
