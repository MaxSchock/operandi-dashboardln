import { NextRequest, NextResponse } from "next/server";
import { backTo, reasonOf, resolveActor, strategist } from "@/lib/calling-server";

/** POST /api/calling/topup?slug=&target=  -> strategist fills the calling queue from Apollo. Admin only (spends credits). */
export async function POST(req: NextRequest) {
  const who = await resolveActor();
  if ("error" in who) return who.error;
  if (!who.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").trim();
  const target = Math.max(1, Math.min(300, Number(url.searchParams.get("target") ?? 100) || 100));
  if (!/^[a-z0-9_-]{1,64}$/.test(slug)) return NextResponse.json({ error: "slug required" }, { status: 400 });
  const res = await strategist(`/outreach/calling/${slug}/topup`, { query: { target: String(target) } });
  const back = backTo(req);
  if (!res.ok) {
    back.searchParams.set("notice", `topup:${reasonOf(res.text)}`);
    return NextResponse.redirect(back, 303);
  }
  try {
    const j = JSON.parse(res.text);
    back.searchParams.set("notice", j.ok
      ? `topup:added ${j.added}, duplicates ${j.duplicates}, no phone ${j.skipped_no_phone}, credits ${j.credits}`
      : `topup:${j.reason ?? "failed"}`);
  } catch {
    back.searchParams.set("notice", "topup:done");
  }
  return NextResponse.redirect(back, 303);
}
