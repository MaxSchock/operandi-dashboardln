/** Shapes of the Content screen (types only, so node can import them in tests). */

import type { ImageReview } from "./image-review";

export type Audience = { icp?: number; peer?: number; off?: number; total?: number; icp_pct?: number } | null;
export type Engagement = {
  reactions?: number; comments?: number; reposts?: number; impressions?: number; score?: number;
  audience?: Audience;
} | null;

export type CalendarRow = {
  content_slug: string;
  content_name: string | null;
  outreach_slug: string | null;
  post_id: string;
  sheet_row: number | null;
  post_type: string | null;
  text_content: string | null;
  text_status: string | null;
  image_status: string | null;
  text_notes?: string | null;
  /** Image notes and the latest check of the picture by the engine's reviewer (view migration 2026_11_10). */
  image_notes?: string | null;
  image_review?: ImageReview | null;
  topic: string | null;
  pain_id: string | null;
  pain_label: string | null;
  /** Writing style the post was drawn with; null for clients without the flag. */
  style?: string | null;
  style_label?: string | null;
  image_url_imgbb: string | null;
  image_url_source: string | null;
  /** The file of a video post. */
  video_url?: string | null;
  scheduled_for: string | null;
  /** When the engine wrote the post (UTC). Not in the content_calendar view: it is read
   * from content_engine_posts by id and is null if that read fails. */
  created_at?: string | null;
  published_at: string | null;
  linkedin_url: string | null;
  linkedin_deleted_at: string | null;
  engagement: Engagement;
};

export type AnalyticsRow = {
  content_slug: string;
  content_name: string | null;
  outreach_slug: string | null;
  avg_icp_pct: string | null;
  topic_icp_fit: Record<string, number> | null;
  topic_weights: Record<string, number> | null;
  first_pass_rate_30d: string | null;
  regression_alert: { since: string; ma_short: number; ma_long: number; ratio: number } | null;
  distilled_rules: string[] | null;
  hard_negatives: string[] | null;
  exemplar_posts: { id: string; text: string; topic: string; score: number }[] | null;
  computed_at: string | null;
};

export type CommentDraftRow = {
  id: string;
  content_slug: string;
  content_name: string | null;
  outreach_slug: string | null;
  post_id: string | null;
  sheet_row: number | null;
  linkedin_url: string | null;
  comment_author: string | null;
  comment_text: string | null;
  comment_type: string | null;
  reply_text: string | null;
  action: string;
  created_at: string;
};

export type ContentData = {
  isAdmin: boolean;
  /** The client slug whose posts this (non-admin) user manages, if any. */
  ownSlug: string | null;
  posts: CalendarRow[];
  analytics: AnalyticsRow[];
  drafts: CommentDraftRow[];
  draftsError: string | null;
  /** Content slugs, among those this person can see, whose comment replies are switched off
   * for the client (see content-config). Always empty for an admin: the admin keeps them. */
  commentRepliesOff: string[];
  /** Locale dates are written in: the client's own, else the browser's. */
  locale: string;
  /** The server's clock when this was read (ms). The "new" mark counts from it, never from the
   * browser's clock, so the first render is the same on both sides and a slow clock cannot hide it. */
  servedAt: number;
};
