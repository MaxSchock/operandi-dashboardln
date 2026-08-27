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
  batch?: string;
  added_at?: string;
  calls?: number;
  last_call_at?: string;
  last_notes?: string | null;
  callback_at?: string | null;
  linkedin_connect?: boolean;
  segment?: string | null;
  notes?: string | null;
  nurture?: { sequence_id?: number; status?: string; step?: number; last_sent_at?: string } | null;
};

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
