import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/content-post/:slug/:row?action=approve|suspend|revise-text|revise-image|edit-text
 *   body (form or JSON): notes (revise-*), text (edit-text)
 *
 * Admin, or the client that owns the content slug. Ownership is resolved
 * server-side (client_users.client_slug -> clients_master.content_engine_slug
 * must equal the URL slug); the URL is never trusted. Suspend stays admin-only
 * (it feeds hard-negative learning). Delegates to the strategist proxy, which
 * forwards to the internal content-engine daemon (writes the Google Sheet +
 * content_engine_posts).
 */
const ADMIN_ACTIONS = new Set(["approve", "suspend", "revise-text", "revise-image", "edit-text", "set-date", "upload-image", "reset-published"]);
// suspend is owner-visible since 2026-07-08 (Cardeleine ask): a client suspending
// their own post is a legitimate hard-negative signal.
// reset-published is owner-visible too: it self-guards by verifying the LinkedIn post
// is really gone before unlocking anything, so the owner can't duplicate a live post.
const OWNER_ACTIONS = new Set(["approve", "suspend", "revise-text", "revise-image", "edit-text", "set-date", "upload-image", "reset-published"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string; row: string }> }) {
  const { slug, row } = await ctx.params;
  const action = new URL(req.url).searchParams.get("action") ?? "";
  if (!ADMIN_ACTIONS.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 400 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { data: cu } = await sb.from("client_users").select("role, client_slug").eq("user_id", user.id).maybeSingle();
  const isAdmin = cu?.role === "operandi_admin";

  if (!isAdmin) {
    if (!OWNER_ACTIONS.has(action)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (!cu?.client_slug) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    // Ownership is proven through RLS, not the URL: content_calendar only
    // returns rows mapped to the caller's client_slug, so finding this exact
    // slug+row there means the caller owns the post. client_features is
    // self-readable and gates the content product.
    const [{ data: cf }, { data: owned }] = await Promise.all([
      sb.from("client_features").select("has_content").eq("client_slug", cu.client_slug).maybeSingle(),
      sb.from("content_calendar").select("content_slug, sheet_row")
        .eq("content_slug", slug).eq("sheet_row", Number(row)).limit(1).maybeSingle(),
    ]);
    if (!cf?.has_content || !owned) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Build the body the daemon expects.
  let payload: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    payload = await req.json();
  } else {
    const fd = await req.formData();
    // Row-identity guard: the daemon refuses the action if this post_id no longer
    // lives at this sheet_row (suspended-row cleanup shifts rows underneath users).
    const pid = String(fd.get("post_id") ?? "");
    if (pid) payload.post_id = pid;
    if (action === "edit-text") payload = { ...payload, text: String(fd.get("text") ?? "") };
    else if (action === "revise-text" || action === "revise-image") payload = { ...payload, notes: String(fd.get("notes") ?? "") };
    else if (action === "set-date") payload = { ...payload, date: String(fd.get("date") ?? ""), time: String(fd.get("time") ?? "") };
    else if (action === "upload-image") {
      const file = fd.get("image");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "no image file" }, { status: 400 });
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: `image too large (max ${MAX_IMAGE_BYTES} bytes)` }, { status: 413 });
      }
      const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      payload = { ...payload, image_b64: b64, filename: file.name || "upload.png" };
    }
  }

  const base = process.env.STRATEGIST_BASE_URL;
  const token = process.env.STRATEGIST_WEBHOOK_TOKEN;
  if (!base) return NextResponse.json({ error: "STRATEGIST_BASE_URL not set" }, { status: 500 });

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/content/post/${encodeURIComponent(slug)}/${encodeURIComponent(row)}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-webhook-token": token } : {}) },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: `strategist unreachable: ${String(e)}` }, { status: 502 });
  }
  // 303 so the browser re-GETs the page, anchored on the card just acted on —
  // otherwise every action lands the user back at the top of the list.
  const back = new URL(req.headers.get("referer") ?? "/content", req.url);
  back.hash = `post-${slug}-${row}`;
  if (!res.ok) {
    // Failures go back to the page too (raw JSON is unreadable for clients).
    // The daemon's reason travels in ?actionError and renders as a banner.
    const detail = await res.text().catch(() => "");
    let reason = detail;
    try { reason = JSON.parse(detail).detail ?? detail; } catch { /* keep raw */ }
    back.searchParams.set("actionError", String(reason).slice(0, 220));
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.delete("actionError");
  return NextResponse.redirect(back, 303);
}
