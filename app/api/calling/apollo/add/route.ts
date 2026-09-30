import { NextRequest, NextResponse } from "next/server";
import { resolveActor, strategist } from "@/lib/calling-server";

/** POST /api/calling/apollo/add?client=  (form: id[], filters, back). Admin only: spends
 *  Apollo credits. The strategist enforces the client's monthly cap before revealing anyone. */
export async function POST(req: NextRequest) {
  const who = await resolveActor();
  if ("error" in who) return who.error;
  if (!who.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const client = req.nextUrl.searchParams.get("client") ?? "";
  if (!/^[a-z0-9_-]{1,64}$/.test(client)) return NextResponse.json({ error: "client required" }, { status: 400 });
  const fd = await req.formData();
  const backPath = String(fd.get("back") ?? "");
  const back = new URL(backPath.startsWith("/calling/find") ? backPath : `/calling/find?client=${client}`, req.url);
  const ids = fd.getAll("id").map(String).filter(Boolean);
  let filters: unknown = {};
  try { filters = JSON.parse(String(fd.get("filters") ?? "{}")); } catch { /* keep empty */ }

  const res = await strategist(`/outreach/calling/${client}/apollo/add`, { json: { ids, actor: who.actor, filters } });
  let msg: string;
  try {
    const j = JSON.parse(res.text);
    msg = j.ok === true && typeof j.added === "number"
      ? `Added ${j.added} to To call, credits used ${j.credits}.${j.no_phone ? ` ${j.no_phone} came without a phone: look the number up on their website.` : ""}${j.duplicates ? ` ${j.duplicates} were already in.` : ""}${j.failed ? ` ${j.failed} failed.` : ""}`
      : `Nothing added: ${j.reason ?? j.detail ?? "unexpected answer"}`;
  } catch {
    msg = `Nothing confirmed (strategist ${res.status}). Check the To call tab before trying again.`;
  }
  back.searchParams.set("notice", msg);
  return NextResponse.redirect(back, 303);
}
