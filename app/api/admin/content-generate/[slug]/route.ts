import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/content-generate/:slug
 *   body (form or JSON): count (int), mode ("auto" | "manual"), topics (textarea, one per line)
 *
 * Operandi-admin only. Triggers on-demand post generation via the strategist proxy, which
 * forwards to the internal content-engine daemon. The daemon generates in the background,
 * so this returns fast; the new posts appear in the buffer (status New) on the next refresh.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { data: cu } = await sb.from("client_users").select("role").eq("user_id", user.id).maybeSingle();
  if (cu?.role !== "operandi_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
  count = Math.max(1, Math.min(10, count)); // clamp 1..10

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
