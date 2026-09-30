import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { requireFeature, resolveActor } from "@/lib/calling-server";

/**
 * POST /api/calling/config?client=slug  (form body from /calling/settings)
 * Operators may change what they see on the phone (hint, objections, market note) for
 * their own client; everything that shapes the emails is admin-only and ignored otherwise.
 */
const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const text = (v: FormDataEntryValue | null, max = 2000) => String(v ?? "").trim().slice(0, max) || null;

export async function POST(req: NextRequest) {
  const who = await resolveActor();
  if ("error" in who) return who.error;
  const gate = await requireFeature(who, "has_outreach");
  if (gate) return gate;
  const client = who.isAdmin ? (req.nextUrl.searchParams.get("client") ?? "") : (who.clientSlug ?? "");
  if (!client || client === "all") return NextResponse.json({ error: "client required" }, { status: 400 });

  const back = new URL(`/calling/settings?client=${encodeURIComponent(client)}`, req.url);
  const fail = (msg: string) => { back.searchParams.set("error", msg); return NextResponse.redirect(back, 303); };
  if (req.nextUrl.searchParams.get("action") === "resume") {
    // Admin clears a mailbox paused by the bounce scan.
    if (!who.isAdmin) return fail("only Operandi can resume a paused mailbox");
    const { error } = await serviceRoleClient().schema("outreach").from("calling_config")
      .update({ mailbox_paused_at: null, mailbox_paused_reason: null, updated_at: new Date().toISOString(), updated_by: who.actor })
      .eq("client_slug", client);
    if (error) return fail(error.message);
    back.searchParams.set("saved", "1");
    return NextResponse.redirect(back, 303);
  }
  const fd = await req.formData().catch(() => null);
  if (!fd) return fail("could not read the form");

  const objections = lines(fd.get("objections")).map(l => {
    const [objection, ...rest] = l.split("=>");
    return { objection: objection.trim(), answer: rest.join("=>").trim() };
  }).filter(o => o.objection && o.answer);
  const row: Record<string, unknown> = {
    client_slug: client,
    call_hint: text(fd.get("call_hint"), 300),
    compliance_note: text(fd.get("compliance_note")),
    objections,
    updated_at: new Date().toISOString(),
    updated_by: who.actor,
  };

  if (who.isAdmin) {
    const tz = text(fd.get("default_timezone"), 64);
    if (tz) {
      try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { return fail("unknown time zone"); }
    }
    const lang = text(fd.get("default_language"), 16);
    if (lang && !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) return fail("language like es, de, fr, nl or en-GB");
    let branches: unknown;
    try { branches = JSON.parse(String(fd.get("branches") ?? "[]")); } catch { return fail("branches is not valid JSON"); }
    if (!Array.isArray(branches) || !branches.every(b =>
      b && typeof b.key === "string" && /^[a-z0-9_]{1,32}$/.test(b.key) && typeof b.label === "string"
      && (b.angles === undefined || (Array.isArray(b.angles) && b.angles.every((a: unknown) => typeof a === "string"))))) {
      return fail("each branch needs key (a-z, 0-9, _), label and a list of angles");
    }
    if (!branches.some((b: { key: string }) => b.key === "generic")) return fail("keep a branch with key generic, it is the fallback");
    const num = (k: string, lo: number, hi: number, dflt: number) => {
      const n = Number(fd.get(k));
      return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
    };
    const days = fd.getAll("send_days").map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 7);
    const start = num("send_start_hour", 0, 23, 9);
    const end = num("send_end_hour", 1, 24, 17);
    if (end <= start) return fail("the sending window ends before it starts");
    if (days.length === 0) return fail("pick at least one sending day");
    const cap = String(fd.get("apollo_monthly_credits") ?? "").trim();
    Object.assign(row, {
      apollo_monthly_credits: cap === "" ? null : num("apollo_monthly_credits", 0, 20000, 300),
      default_country: text(fd.get("default_country"), 64),
      default_timezone: tz,
      default_language: lang,
      default_size: ["all", "1-4", "5-20", "21-50", "51+", "unknown"].includes(String(fd.get("default_size"))) ? String(fd.get("default_size")) : "all",
      send_days: days, send_start_hour: start, send_end_hour: end,
      total_steps: num("total_steps", 1, 8, 4), gap_days: num("gap_days", 1, 60, 7),
      require_consent: fd.get("require_consent") === "on",
      sender_name: text(fd.get("sender_name"), 120), sender_company: text(fd.get("sender_company"), 120),
      signature: text(fd.get("signature"), 500), booking_link: text(fd.get("booking_link"), 300),
      opt_out_line: text(fd.get("opt_out_line"), 300),
      proof_points: lines(fd.get("proof_points")), rules: lines(fd.get("rules")),
      branches,
    });
  }

  const admin = serviceRoleClient().schema("outreach");
  const { error } = await admin.from("calling_config").upsert(row, { onConflict: "client_slug" });
  if (error) return fail(error.message);
  back.searchParams.set("saved", "1");
  return NextResponse.redirect(back, 303);
}
