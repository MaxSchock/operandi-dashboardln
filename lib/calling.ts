/**
 * Calling cockpit helpers shared by the page and the API routes.
 *
 * A "calling lead" is a lead_state row with channel_state.calling set. The stage stays
 * `paused` so the LinkedIn decisor never touches it; ticking "connect on LinkedIn" moves
 * it to `pre_contact` and the normal connect-only machinery takes over.
 */

export const CALL_OUTCOMES = ["no_answer", "red", "orange", "green"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const OUTCOME_LABEL: Record<string, string> = {
  queued: "To call",
  no_answer: "No answer",
  red: "Red · no interest",
  orange: "Orange · send email",
  green: "Green · meeting",
  replied: "Replied by email",
};

export const OUTCOME_TONE: Record<string, "slate" | "green" | "amber" | "red" | "electric"> = {
  queued: "slate",
  no_answer: "slate",
  red: "red",
  orange: "amber",
  green: "green",
  replied: "electric",
};

export const NURTURE_BRANCHES = [
  { key: "more_leads", label: "Can take more work" },
  { key: "overwhelmed", label: "Overwhelmed" },
  { key: "generic", label: "Not clear yet" },
] as const;

export type CallingState = {
  status?: string;
  /** Where the lead sits in the follow-up, independent of the last call's outcome:
   *  a lead in follow-up that does not pick up on the next call stays in follow-up. */
  stage?: CallingStage;
  batch?: string;
  added_at?: string;
  calls?: number;
  last_call_at?: string;
  last_notes?: string | null;
  callback_at?: string | null;
  meeting_at?: string | null;
  email_consent?: boolean;
  email_consent_at?: string | null;
  reply_at?: string | null;
  reply_channel?: "email" | "linkedin" | null;
  reply_handled_at?: string | null;
  closed_reason?: string | null;
  linkedin_connect?: boolean;
  segment?: string | null;
  notes?: string | null;
  nurture?: { sequence_id?: number; status?: string; step?: number; last_sent_at?: string } | null;
};

export const CALLING_STAGES = ["to_call", "follow_up", "meeting", "closed"] as const;
export type CallingStage = (typeof CALLING_STAGES)[number];

export const STAGE_LABEL: Record<CallingStage, string> = {
  to_call: "To call",
  follow_up: "Following up",
  meeting: "Meeting",
  closed: "Closed",
};

/** Stage for rows written before `stage` existed: derived from the last outcome once. */
export function stageOf(cs: CallingState | undefined | null, currentStage?: string | null): CallingStage {
  if (currentStage === "opted_out") return "closed";
  if (cs?.stage && (CALLING_STAGES as readonly string[]).includes(cs.stage)) return cs.stage;
  switch (cs?.status) {
    case "red": return "closed";
    case "green": return "meeting";
    case "orange":
    case "replied": return "follow_up";
    default: return "to_call";
  }
}

/** Stage after logging a call. No answer never moves a lead backwards. */
export function stageAfterCall(prev: CallingStage, outcome: CallOutcome): CallingStage {
  if (outcome === "red") return "closed";
  if (outcome === "green") return "meeting";
  if (outcome === "orange") return prev === "meeting" ? "meeting" : "follow_up";
  return prev === "closed" ? "to_call" : prev;
}

/** The latest reply we know of on any channel, or null. */
export function latestReply(
  cs: CallingState | undefined | null,
  li: { current_stage?: string | null; last_inbound_at?: string | null },
): { at: string; channel: "email" | "linkedin" } | null {
  const out: { at: string; channel: "email" | "linkedin" }[] = [];
  if (cs?.reply_at) out.push({ at: cs.reply_at, channel: cs.reply_channel ?? "email" });
  else if (cs?.nurture?.status === "replied" || cs?.status === "replied") {
    out.push({ at: cs?.nurture?.last_sent_at ?? cs?.last_call_at ?? cs?.added_at ?? "", channel: "email" });
  }
  if ((li.current_stage === "replied" || li.current_stage === "qualified") && li.last_inbound_at) {
    out.push({ at: li.last_inbound_at, channel: "linkedin" });
  }
  out.sort((a, b) => ts(b.at) - ts(a.at));
  return out[0] ?? null;
}

export function replyUnhandled(cs: CallingState | undefined | null, reply: { at: string } | null): boolean {
  if (!reply) return false;
  const handled = cs?.reply_handled_at ?? "";
  return !handled || ts(handled) < ts(reply.at);
}

/** Epoch ms of a stored timestamp. Rows mix "Z" and "+00:00" and Postgres' own text
 *  form, so comparing the strings is not safe. Unparseable counts as never (0). */
export function ts(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Date.parse(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(n) ? 0 : n;
}

/** LinkedIn stage in words, for a lead the operator chose to connect with. */
export const LINKEDIN_LABEL: Record<string, string> = {
  pre_contact: "invite queued",
  invited: "invite sent",
  engaged_post: "engaged with a post",
  accepted: "connected",
  messaged: "message sent",
  replied: "replied",
  qualified: "qualified",
  opted_out: "opted out",
  expired: "invite expired",
};

export const TABS = ["today", "to_call", "follow_up", "meeting", "closed"] as const;
export type CallingTab = (typeof TABS)[number];
export const TAB_LABEL: Record<CallingTab, string> = {
  today: "Today",
  to_call: "To call",
  follow_up: "Following up",
  meeting: "Meetings",
  closed: "Closed",
};

/** Start of tomorrow in `tz`, as an ISO instant. Anything due before it is "today". */
export function endOfTodayIso(tz: string, now = new Date()): string {
  let zone = tz;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: zone }); } catch { zone = "Europe/London"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(p => [p.type, p.value]));
  const minutesIntoDay = Number(parts.hour) * 60 + Number(parts.minute);
  return new Date(now.getTime() + (24 * 60 - minutesIntoDay) * 60_000 - now.getSeconds() * 1000).toISOString();
}

export function fmtWhen(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
}

export function isEmail(s: string): boolean {
  return /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}$/i.test(s);
}

export type Enrichment = {
  organization?: {
    name?: string | null;
    phone?: string | null;
    website_url?: string | null;
    industry?: string | null;
    estimated_num_employees?: number | null;
    city?: string | null;
  } | null;
  city?: string | null;
  profile_url?: string | null;
  linkedin_url?: string | null;
} | null;

export function orgPhone(lead: { phone?: string | null; enrichment?: Enrichment }): string | null {
  return lead.phone || lead.enrichment?.organization?.phone || null;
}

export function orgSize(lead: { enrichment?: Enrichment }): number | null {
  const n = lead.enrichment?.organization?.estimated_num_employees;
  return typeof n === "number" ? n : null;
}

export function sizeBucket(n: number | null): "5-20" | "21-50" | "51+" | "1-4" | "unknown" {
  if (n === null) return "unknown";
  if (n < 5) return "1-4";
  if (n <= 20) return "5-20";
  if (n <= 50) return "21-50";
  return "51+";
}

export function websiteHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Minimal CSV parser: comma or semicolon, quoted fields, CRLF. Header row required. */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ";" : ",";
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { cur.push(field); field = ""; }
    else if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (rows.length < 2) return [];
  const header = rows[0].map(h => normaliseHeader(h));
  return rows.slice(1)
    .filter(r => r.some(v => v.trim()))
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function normaliseHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const map: Record<string, string> = {
    name: "full_name", full_name: "full_name", contact: "full_name", contact_name: "full_name",
    first_name: "first_name", firstname: "first_name", last_name: "last_name", lastname: "last_name", surname: "last_name",
    company: "company", company_name: "company", organisation: "company", organization: "company", business: "company",
    email: "email", e_mail: "email", email_address: "email",
    linkedin: "linkedin_url", linkedin_url: "linkedin_url", profile: "linkedin_url",
    phone: "phone", telephone: "phone", tel: "phone", mobile: "phone", phone_number: "phone",
    website: "website", web: "website", url: "website", domain: "website",
    notes: "notes", note: "notes", comment: "notes", comments: "notes",
  };
  return map[k] ?? k;
}

/** outreach.calling_config: what used to be hard-coded for Zayd, per client. */
export type CallingConfig = {
  client_slug: string;
  branches: { key: string; label: string; angles?: string[] }[];
  call_hint: string | null;
  default_size: string;
  default_country: string | null;
  default_language: string | null;
  default_timezone: string | null;
  send_days: number[];
  send_start_hour: number;
  send_end_hour: number;
  total_steps: number | null;
  gap_days: number | null;
  require_consent: boolean;
  sender_name: string | null;
  sender_company: string | null;
  signature: string | null;
  booking_link: string | null;
  opt_out_line: string | null;
  proof_points: string[];
  rules: string[];
  compliance_note: string | null;
  objections: { objection: string; answer: string }[];
  mailbox_paused_at?: string | null;
  apollo_monthly_credits?: number | null;
  mailbox_paused_reason?: string | null;
};

export const DEFAULT_CALL_HINT = "What they said: what is their situation, what is the bottleneck, who decides?";

/** Same fallback order as the strategist's lead_locale (nurture.py). Keep them in step. */
const COUNTRY_LANGUAGE: Record<string, string> = {
  "united kingdom": "en-GB", ireland: "en-GB", "united states": "en-US", canada: "en-US", australia: "en-GB",
  spain: "es", mexico: "es", argentina: "es", colombia: "es", chile: "es",
  germany: "de", austria: "de", switzerland: "de", france: "fr", belgium: "fr", luxembourg: "fr",
  netherlands: "nl", italy: "it", portugal: "pt", brazil: "pt",
};

const COUNTRY_TZ: Record<string, string> = {
  "united kingdom": "Europe/London", ireland: "Europe/Dublin", spain: "Europe/Madrid", germany: "Europe/Berlin",
  austria: "Europe/Vienna", switzerland: "Europe/Zurich", france: "Europe/Paris", belgium: "Europe/Brussels",
  luxembourg: "Europe/Luxembourg", netherlands: "Europe/Amsterdam", italy: "Europe/Rome", portugal: "Europe/Lisbon",
};

export function leadLocale(
  lead: { country?: string | null; timezone?: string | null; language?: string | null; enrichment?: unknown },
  cfg: Pick<CallingConfig, "default_country" | "default_timezone" | "default_language"> | null,
): { country: string; tz: string; language: string } {
  const e = (lead.enrichment ?? {}) as { country?: string | null; time_zone?: string | null; organization?: { country?: string | null } | null };
  const country = lead.country || e.country || e.organization?.country || cfg?.default_country || "";
  const tz = lead.timezone || e.time_zone || COUNTRY_TZ[country.trim().toLowerCase()] || cfg?.default_timezone || "Europe/London";
  const language = lead.language || COUNTRY_LANGUAGE[country.trim().toLowerCase()] || cfg?.default_language || "en-GB";
  return { country, tz, language };
}

export function localTime(tz: string, now = new Date()): string {
  try {
    return now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short" });
  } catch {
    return "";
  }
}

/** What the calling routes answer with (`?notice=`), in words. Shown as the page
 * banner and under the form that caused it. */
export const NOTICE_COPY: Record<string, string> = {
  "nurture:drafted": "Call saved. Email 1 is drafted in Today, read it and approve to send.",
  "nurture:no_email": "Call saved, but this lead has no email address, so no follow-up email was opened. Add the address on the next call.",
  "nurture:no_consent": "Call saved. No email was drafted because they did not say yes to an email.",
  "nurture:sequence_exists": "Call saved. A follow-up sequence is already open for this lead.",
  "nurture:draft_failed": "Call saved, but the email draft could not be written. Try again from the card.",
  "call:bad_email": "Not saved: that email address does not look right.",
  "email:sent": "Email sent from your mailbox.",
  "email:queued": "Approved. It goes out in the next sending window.",
  "email:rejected": "Draft rejected, sequence stopped.",
  "email:stopped": "Sequence stopped.",
  "email:no_email_account": "Your mailbox is not connected yet, nothing was sent. Ask Max for the connection link.",
  "email:inbound_unanswered": "Not sent: they already wrote to you. Reply by hand, the sequence is stopped.",
  "email:already_messaged": "Not sent: you already emailed this person by hand. Continue that thread yourself.",
  "email:provider_unreachable": "Not sent: the mailbox could not be reached. Nothing went out, try again later.",
  "email:daily_quota_reached": "Not sent: today's email cap is reached. It will go out tomorrow.",
  "email:mailbox_paused": "Not sent: follow-up emails are paused because too many bounced. See Settings.",
  "email:bounced": "Not sent: this address bounced. Get the right one on the next call.",
};

/** A notice in words: its sentence, or the code itself made readable. */
export function noticeText(raw: string, copy: Record<string, string> = {}): string {
  return copy[raw] ?? raw.replace(/^[a-z_]+:/, "").replace(/_/g, " ");
}
