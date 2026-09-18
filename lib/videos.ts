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
    /** Client reviews the keyframes before production; credit is consumed at that approval. */
    video_keyframe_review: boolean;
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
      .select("video_enabled, video_weekly_quota, video_regens_per_video, video_max_duration_s, voice_consent_at, video_keyframe_review")
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

/** Conservative per-render estimates (standard-tier pricing) used for the cap check.
 * broll now always carries a narrator voiceover + STT captions; client-uploaded
 * clips replace generated shots, so real cost usually lands below this. */
export function estimateCostUsd(style: string, durationS: number, voice: boolean): number {
  const perSecond = style === "typography" ? 0 : style === "talking_head" ? 0.14 : 0.3024;
  const extras = 0.2 + (style === "typography" ? 0 : 0.15) + (voice ? 0.05 : 0);
  return Math.round((perSecond * durationS + extras) * 100) / 100;
}

export const QUOTA_MESSAGES: Record<string, string> = {
  weekly_quota_reached: "Weekly quota reached: you have 1 video per week. The next slot opens on Monday.",
  regen_quota_reached: "This video already used its 1 paid regeneration.",
  monthly_cap_reached: "The monthly production budget for your account is used up. Ask Max if you need more.",
  video_not_enabled: "Video is not enabled for this client.",
  duration_exceeds_max: "The requested duration exceeds your plan limit.",
  keyframes_not_approved: "Approve every image before starting production.",
};

type BoardShot = { recipe?: string | null; source_ref?: string | null };

/** True when the storyboard has shots that are drawn as stills before any
 * footage (broll shots with an image recipe and no client clip). Only those
 * requests go through the keyframe review; everything else is produced
 * straight from the script, as before. Mirrors keyframes.build_for_request. */
export function needsKeyframes(brief: Record<string, unknown>, storyboard: Record<string, unknown> | null): boolean {
  if (brief?.style !== "broll") return false;
  const shots = ((storyboard?.shots as BoardShot[] | undefined) ?? []);
  return shots.some(s => (s.recipe === "image" || s.recipe === "first_last") && !s.source_ref);
}

/** Client redraws allowed per image (the engine caps its own automatic retries separately). */
export const MAX_KEYFRAME_REDRAWS = 3;

export type Keyframe = {
  id: string;
  shot_n: number;
  role: "start" | "end";
  storage_key: string | null;
  status: "proposed" | "approved" | "rejected" | "failed";
  version: number;
  notes: string | null;
  qc: { ok?: boolean; reason?: string } | null;
};

/** The image that stands for each (shot, role): its latest version. Earlier
 * versions (rejected by the automatic check or by the client) are history. */
export function latestKeyframes(rows: Keyframe[]): Keyframe[] {
  const latest = new Map<string, Keyframe>();
  for (const k of rows) {
    const key = `${k.shot_n}:${k.role}`;
    const cur = latest.get(key);
    if (!cur || k.version > cur.version) latest.set(key, k);
  }
  return [...latest.values()].sort((a, b) => a.shot_n - b.shot_n || (a.role === "start" ? -1 : 1));
}

/** How many times the client has rejected this image with a note. */
export function clientRedraws(rows: Keyframe[], shotN: number, role: string): number {
  return rows.filter(k => k.shot_n === shotN && k.role === role && k.status === "rejected" && (k.notes ?? "").trim()).length;
}

export function wantsJson(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").includes("application/json");
}
