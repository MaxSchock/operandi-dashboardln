import { NextRequest, NextResponse } from "next/server";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/template/:id
 *   query ?action=approve|activate|deactivate    → flips a flag, redirects back
 *   action=save (form body or JSON) →  updates body + meta.variants + marks approved by current user
 *
 * Operandi-admin only.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tid = Number(id);
  if (Number.isNaN(tid)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const { data: cu } = await sb.from("client_users").select("role,email").eq("user_id", user.id).maybeSingle();
  if (cu?.role !== "operandi_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const action = new URL(req.url).searchParams.get("action") ?? "approve";
  const admin = serviceRoleClient();
  const approver = cu?.email ?? user.email ?? "operandi_admin";

  if (action === "approve") {
    const { error } = await admin.schema("outreach").from("templates_approved")
      .update({ approved_by: approver, approved_at: new Date().toISOString() })
      .eq("id", tid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/templates", req.url));
  }

  if (action === "deactivate" || action === "activate") {
    const { error } = await admin.schema("outreach").from("templates_approved")
      .update({ active: action === "activate" }).eq("id", tid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/templates", req.url));
  }

  if (action === "save") {
    // Accept either form-encoded or JSON body.
    let body = "";
    let variantsRaw = "";
    let stayActive = true;
    let arm_key_payload: string | null | undefined = undefined;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = await req.json();
      body = String(j.body ?? "");
      variantsRaw = String(j.variants ?? "");
      if (typeof j.active === "boolean") stayActive = j.active;
      if (j.arm_key !== undefined) arm_key_payload = j.arm_key === "" ? null : String(j.arm_key);
    } else {
      const fd = await req.formData();
      body = String(fd.get("body") ?? "");
      variantsRaw = String(fd.get("variants") ?? "");
      stayActive = fd.get("active") !== "off";
      const ak = fd.get("arm_key");
      if (ak !== null) arm_key_payload = ak === "" ? null : String(ak);
    }

    // Variants: one per line, trimmed, empty lines skipped.
    const variants = variantsRaw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    // Pull existing meta to merge.
    const { data: cur } = await admin.schema("outreach").from("templates_approved")
      .select("meta").eq("id", tid).maybeSingle();
    const meta = (cur?.meta as Record<string, unknown> | null) ?? {};
    if (variants.length > 0) {
      meta["variants"] = variants;
      meta["variants_available"] = variants.length;
    } else {
      delete (meta as Record<string, unknown>)["variants"];
      delete (meta as Record<string, unknown>)["variants_available"];
    }

    const update: Record<string, unknown> = {
      body,
      meta,
      active: stayActive,
      approved_by: approver,
      approved_at: new Date().toISOString(),
    };
    if (arm_key_payload !== undefined) update["arm_key"] = arm_key_payload;

    const { error } = await admin.schema("outreach").from("templates_approved")
      .update(update).eq("id", tid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.redirect(new URL("/templates", req.url));
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
