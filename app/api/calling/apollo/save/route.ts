import { NextRequest, NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/server";
import { resolveActor } from "@/lib/calling-server";
import { answer } from "@/lib/form-answer";

/** POST /api/calling/apollo/save?client=  (form: name, filters). Saves or replaces a named search. */
export async function POST(req: NextRequest) {
  const who = await resolveActor();
  if ("error" in who) return who.error;
  if (!who.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const client = req.nextUrl.searchParams.get("client") ?? "";
  if (!/^[a-z0-9_-]{1,64}$/.test(client)) return NextResponse.json({ error: "client required" }, { status: 400 });
  const fd = await req.formData();
  const name = String(fd.get("name") ?? "").trim().slice(0, 40);
  let filters: unknown;
  try { filters = JSON.parse(String(fd.get("filters") ?? "")); } catch { filters = null; }
  const back = new URL(`/calling/find?client=${encodeURIComponent(client)}`, req.url);
  if (!name || !filters || typeof filters !== "object") {
    back.searchParams.set("notice", "Not saved: give the search a name.");
    return answer(req, back);
  }
  const admin = serviceRoleClient().schema("outreach");
  const { data } = await admin.from("calling_config").select("apollo_saved_searches").eq("client_slug", client).maybeSingle();
  const saved = ((data?.apollo_saved_searches ?? []) as { name: string }[]).filter(s => s.name !== name);
  const { error } = await admin.from("calling_config").upsert({
    client_slug: client, apollo_saved_searches: [...saved, { name, filters }].slice(-20),
    updated_at: new Date().toISOString(), updated_by: who.actor,
  }, { onConflict: "client_slug" });
  back.searchParams.set("notice", error ? `Not saved: ${error.message}` : `Saved "${name}".`);
  return answer(req, back);
}
