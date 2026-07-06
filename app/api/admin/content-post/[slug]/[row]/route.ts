import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/content-post/:slug/:row?action=approve|suspend|revise-text|revise-image|edit-text
 *   body (form or JSON): notes (revise-*), text (edit-text)
 *
 * Operandi-admin only. Delegates to the strategist proxy, which forwards to the internal
 * content-engine daemon (writes the Google Sheet + content_engine_posts).
 */
const ACTIONS = new Set(["approve", "suspend", "revise-text", "revise-image", "edit-text", "set-date", "upload-image"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string; row: string }> }) {
  const { slug, row } = await ctx.params;
  const action = new URL(req.url).searchParams.get("action") ?? "";
  if (!ACTIONS.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 400 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { data: cu } = await sb.from("client_users").select("role").eq("user_id", user.id).maybeSingle();
  if (cu?.role !== "operandi_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Build the body the daemon expects.
  let payload: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    payload = await req.json();
  } else {
    const fd = await req.formData();
    if (action === "edit-text") payload = { text: String(fd.get("text") ?? "") };
    else if (action === "revise-text" || action === "revise-image") payload = { notes: String(fd.get("notes") ?? "") };
    else if (action === "set-date") payload = { date: String(fd.get("date") ?? ""), time: String(fd.get("time") ?? "") };
    else if (action === "upload-image") {
      const file = fd.get("image");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "no image file" }, { status: 400 });
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: `image too large (max ${MAX_IMAGE_BYTES} bytes)` }, { status: 413 });
      }
      const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      payload = { image_b64: b64, filename: file.name || "upload.png" };
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
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json({ error: `action ${action} failed: ${res.status} ${detail.slice(0, 300)}` }, { status: 502 });
  }
  return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/content", req.url));
}
