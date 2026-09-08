import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTopics } from "@/lib/topics";

/**
 * POST /api/admin/content-generate/:slug
 *   body (form or JSON): count (int), topics (textarea), text_only (checkbox)
 *
 * A non-empty topics field IS the manual mode: the old auto/manual radio silently
 * threw the typed topics away whenever the caller left it on its "auto" default.
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

  // Build the body the daemon expects: { count, topics, text_only }.
  let count = 3;
  let topicsRaw = "";
  let textOnly = false;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = await req.json();
    count = Number(j.count) || 3;
    // An array is the natural JSON shape and must not be flattened into one string:
    // joining it would now merge every topic into a single post, because commas
    // stopped being separators.
    topicsRaw = Array.isArray(j.topics)
      ? j.topics.map((t: unknown) => String(t ?? "").trim()).filter(Boolean).join("\n")
      : String(j.topics ?? "");
    textOnly = j.text_only === true || j.text_only === 1 || j.text_only === "1"
      || String(j.text_only ?? "").toLowerCase() === "true";
  } else {
    const fd = await req.formData();
    count = Number(fd.get("count")) || 3;
    topicsRaw = String(fd.get("topics") ?? "");
    textOnly = fd.get("text_only") != null;
  }
  const maxCount = isAdmin ? 10 : OWNER_MAX_COUNT;
  count = Math.max(1, Math.min(maxCount, count));

  // One post per requested topic: with count below the number of topics the extra
  // ideas were silently dropped (the daemon round-robins topics[i % n]).
  let topics = parseTopics(topicsRaw);
  let droppedTopics = 0;
  if (topics.length) {
    count = Math.max(count, Math.min(maxCount, topics.length));
    // Over the per-request budget the surplus topics would never be reached at all.
    // Cut them here and say so, instead of sending ideas the daemon will ignore.
    droppedTopics = Math.max(0, topics.length - count);
    topics = topics.slice(0, count);
  }

  const base = process.env.STRATEGIST_BASE_URL;
  const token = process.env.STRATEGIST_WEBHOOK_TOKEN;
  if (!base) return NextResponse.json({ error: "STRATEGIST_BASE_URL not set" }, { status: 500 });

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/content/generate/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-webhook-token": token } : {}) },
      body: JSON.stringify({ count, topics, text_only: textOnly }),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: `strategist unreachable: ${String(e)}` }, { status: 502 });
  }
  // Say what was actually queued. Without this the caller had no way to notice that
  // their topics had been dropped or cut into pieces: the page just reloaded.
  const back = new URL(req.headers.get("referer") ?? "/content", req.url);
  back.searchParams.delete("actionError");
  if (!res.ok) {
    // The strategist turns the daemon's {ok:false} into a 409 with the reason. Show it
    // as the page banner: raw JSON is unreadable for a client (same call as content-post).
    const detail = await res.text().catch(() => "");
    let reason = detail;
    try { reason = JSON.parse(detail).detail ?? detail; } catch { /* keep raw */ }
    back.searchParams.set("actionError", `generate failed: ${String(reason)}`.slice(0, 220));
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.set("queued", String(count));
  back.searchParams.set("queuedTopics", String(topics.length));
  if (droppedTopics > 0) back.searchParams.set("queuedDropped", String(droppedTopics));
  if (textOnly) back.searchParams.set("queuedTextOnly", "1");
  return NextResponse.redirect(back, 303);
}
