import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/content-generate/:slug
 *   body (form or JSON): count (int), mode ("auto" | "manual"), topics (textarea, one per line)
 *
 * Operandi admins, or the client that owns the content slug. Ownership is resolved
 * server-side exactly like content-post: content_calendar only returns rows mapped
 * to the caller's client_slug via RLS, so finding the slug there proves ownership.
 * Owners get a tighter budget: count clamped to 6 per request, and generation is
 * refused once the unpublished buffer holds 18+ posts (6 weeks at 3/week).
 *
 * Triggers on-demand post generation via the strategist proxy, which forwards to the
 * internal content-engine daemon. The daemon generates in the background, so this
 * returns fast; the new posts appear in the buffer (status New) on the next refresh.
 */
const OWNER_MAX_COUNT = 6;
const OWNER_MAX_PENDING = 18;

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { data: cu } = await sb.from("client_users").select("role, client_slug").eq("user_id", user.id).maybeSingle();
  const isAdmin = cu?.role === "operandi_admin";

  if (!isAdmin) {
    if (!cu?.client_slug) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const [{ data: cf }, { data: owned }] = await Promise.all([
      sb.from("client_features").select("has_content").eq("client_slug", cu.client_slug).maybeSingle(),
      sb.from("content_calendar").select("content_slug").eq("content_slug", slug).limit(1).maybeSingle(),
    ]);
    if (!cf?.has_content || !owned) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { count: pending } = await sb
      .from("content_calendar")
      .select("post_id", { count: "exact", head: true })
      .eq("content_slug", slug)
      .is("published_at", null)
      .neq("text_status", "Suspended");
    if ((pending ?? 0) >= OWNER_MAX_PENDING) {
      return NextResponse.json(
        { error: `buffer full: ${pending} unpublished posts (max ${OWNER_MAX_PENDING}). Approve or suspend some first.` },
        { status: 429 },
      );
    }
  }

  // Build the body the daemon expects: { count, topics }.
  let count = 3;
  let mode = "auto";
  let topicsRaw = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = await req.json();
    count = Number(j.count) || 3;
    mode = String(j.mode ?? "auto");
    topicsRaw = String(j.topics ?? "");
  } else {
    const fd = await req.formData();
    count = Number(fd.get("count")) || 3;
    mode = String(fd.get("mode") ?? "auto");
    topicsRaw = String(fd.get("topics") ?? "");
  }
  count = Math.max(1, Math.min(isAdmin ? 10 : OWNER_MAX_COUNT, count));

  const topics =
    mode === "manual"
      ? topicsRaw.split(/[\n,]/).map(t => t.trim()).filter(Boolean)
      : [];

  const base = process.env.STRATEGIST_BASE_URL;
  const token = process.env.STRATEGIST_WEBHOOK_TOKEN;
  if (!base) return NextResponse.json({ error: "STRATEGIST_BASE_URL not set" }, { status: 500 });

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/content/generate/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-webhook-token": token } : {}) },
      body: JSON.stringify({ count, topics }),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: `strategist unreachable: ${String(e)}` }, { status: 502 });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json({ error: `generate failed: ${res.status} ${detail.slice(0, 300)}` }, { status: 502 });
  }
  return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/content", req.url));
}
