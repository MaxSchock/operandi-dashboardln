"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Initializes PostHog (EU cloud) for product analytics, session replay and
 * error tracking. Inert until NEXT_PUBLIC_POSTHOG_KEY is set in the env, so
 * the component can ship before the PostHog project exists.
 * Replay masks all inputs by default (PostHog default), which is what we want
 * for EU client users (DSGVO); see the analytics notice in the app footer.
 */
export function PostHogInit() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
      defaults: "2025-05-24",
      capture_exceptions: true,
    });
  }, []);
  return null;
}

/** Ties the PostHog session to the logged-in dashboard user (called from the
 * authenticated layout, so the login page stays anonymous). */
export function PostHogIdentify({ email, clientSlug, role }: {
  email: string | null;
  clientSlug: string | null;
  role: string | null;
}) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || !email) return;
    posthog.identify(email, { client_slug: clientSlug, role });
  }, [email, clientSlug, role]);
  return null;
}
