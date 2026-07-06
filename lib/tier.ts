import { createClient } from "@/lib/supabase/server";

export type ClientFeatures = {
  client_slug: string;
  has_outreach: boolean;
  has_content: boolean;
  video_enabled: boolean;
  video_weekly_quota: number;
  video_regens_per_video: number;
  video_max_duration_s: number;
  video_monthly_cap_usd: number;
  voice_consent_at: string | null;
};

export type Tier = {
  userId: string | null;
  isAdmin: boolean;
  role: string | null;
  clientSlug: string | null;
  displayName: string | null;
  email: string | null;
  features: ClientFeatures | null;
  /** Outreach pages (Leads, Warm DMs, Activity, Templates) unlocked. */
  hasOutreach: boolean;
  /** Videos section unlocked (admins always; clients per feature flag). */
  videoEnabled: boolean;
};

/**
 * Resolve the current user's role + product features server-side.
 * RLS on client_users (self) and client_features (own slug) means the anon-key
 * client can only ever read the caller's own rows. Clients without a
 * client_features row keep the historical behaviour (full outreach UI).
 */
export async function getTier(): Promise<Tier> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return {
      userId: null, isAdmin: false, role: null, clientSlug: null,
      displayName: null, email: null, features: null,
      hasOutreach: true, videoEnabled: false,
    };
  }

  const { data: cu } = await sb
    .from("client_users")
    .select("role, client_slug, display_name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin = cu?.role === "operandi_admin";

  let features: ClientFeatures | null = null;
  if (cu?.client_slug) {
    const { data: cf } = await sb
      .from("client_features")
      .select("*")
      .eq("client_slug", cu.client_slug)
      .maybeSingle();
    features = (cf as ClientFeatures | null) ?? null;
  }

  return {
    userId: user.id,
    isAdmin,
    role: cu?.role ?? null,
    clientSlug: cu?.client_slug ?? null,
    displayName: cu?.display_name ?? null,
    email: cu?.email ?? user.email ?? null,
    features,
    hasOutreach: isAdmin || (features ? features.has_outreach : true),
    videoEnabled: isAdmin || (features?.video_enabled ?? false),
  };
}
