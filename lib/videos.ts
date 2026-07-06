import { serviceRoleClient } from "@/lib/supabase/server";
import { getTier, type Tier } from "@/lib/tier";
import { getClientScope } from "@/lib/scope";

export type VideoRequest = {
  id: string;
  client_slug: string;
  content_slug: string;
  status: string;
  brief: Record<string, unknown>;
  duration_s: number;
  recipe: string | null;
  storyboard: Record<string, unknown> | null;
  storyboard_notes: string | null;
  regen_of: string | null;
  consumed_credit: boolean;
  cost_estimated_usd: number | null;
  cost_actual_usd: number | null;
  deliverable_key: string | null;
  deliverable_version: number;
  approved_at: string | null;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type VideoActor = {
  tier: Tier;
  /** Client the action applies to (own slug for clients, scope for admins). */
  clientSlug: string;
  contentSlug: string;
  features: {
    video_enabled: boolean;
    video_weekly_quota: number;
    video_regens_per_video: number;
    video_max_duration_s: number;
    voice_consent_at: string | null;
  };
};

/**
 * Resolve who is acting and for which video client. Clients act for their own
 * slug (video_enabled required). Admins act for the client selected in the
 * scope switcher. Everything is validated against the DB with the service
 * role; the browser never chooses the client.
 */
export async function resolveVideoActor(): Promise<{ actor: VideoActor | null; error: string; status: number }> {
  const tier = await getTier();
  if (!tier.userId) return { actor: null, error: "auth required", status: 401 };

  let clientSlug: string | null = null;
  if (tier.isAdmin) {
    clientSlug = await getClientScope();
    if (!clientSlug) return { actor: null, error: "pick a client in the scope switcher first", status: 400 };
  } else {
    clientSlug = tier.clientSlug;
  }
  if (!clientSlug) return { actor: null, error: "forbidden", status: 403 };

  const svc = serviceRoleClient();
  const [{ data: cf }, { data: cm }] = await Promise.all([
    svc.schema("outreach").from("client_features")
      .select("video_enabled, video_weekly_quota, video_regens_per_video, video_max_duration_s, voice_consent_at")
      .eq("client_slug", clientSlug).maybeSingle(),
    svc.from("clients_master").select("content_engine_slug").eq("client_slug", clientSlug).maybeSingle(),
  ]);
  if (!cf?.video_enabled) return { actor: null, error: "video is not enabled for this client", status: 403 };
  if (!cm?.content_engine_slug) return { actor: null, error: "client has no content engine", status: 403 };

  return {
    actor: { tier, clientSlug, contentSlug: cm.content_engine_slug, features: cf },
    error: "", status: 200,
  };
}

/** Load a request the actor is allowed to touch (own client, or admin). */
export async function loadOwnedRequest(id: string, actor: VideoActor): Promise<VideoRequest | null> {
  const svc = serviceRoleClient();
  const { data } = await svc.from("video_requests").select("*").eq("id", id).maybeSingle();
  const req = data as VideoRequest | null;
  if (!req) return null;
  if (!actor.tier.isAdmin && req.client_slug !== actor.clientSlug) return null;
  return req;
}

export async function addEvent(
  requestId: string,
  eventType: string,
  actor: VideoActor,
  payload?: Record<string, unknown>,
) {
  const svc = serviceRoleClient();
  await svc.from("video_events").insert({
    request_id: requestId,
    event_type: eventType,
    actor: actor.tier.isAdmin ? "admin" : "client",
    actor_id: actor.tier.userId,
    payload: payload ?? null,
  });
}

/** Conservative per-render estimates (standard-tier pricing) used for the cap check. */
export function estimateCostUsd(style: string, durationS: number, voice: boolean): number {
  const perSecond = style === "typography" ? 0 : style === "talking_head" ? 0.14 : 0.3024;
  const extras = 0.2 + (voice ? 0.05 : 0);
  return Math.round((perSecond * durationS + extras) * 100) / 100;
}
