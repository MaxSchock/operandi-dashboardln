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
    // A body that parses but has the wrong shape used to render "added undefined", which
    // reads as a number that happens to be missing rather than as no answer at all.
    if (j && j.ok === true && typeof j.added === "number") {
      back.searchParams.set("notice",
        `topup:added ${j.added}, duplicates ${j.duplicates ?? "?"}, no phone ${j.skipped_no_phone ?? "?"}, credits ${j.credits ?? "?"}`);
    } else if (j && j.ok === false) {
      back.searchParams.set("notice", `topup:${j.reason ?? "failed"}`);
    } else {
      back.searchParams.set("notice", "topup:unexpected response, check before retrying");
    }
  } catch {
    // A 200 with a body we cannot read is not a top-up: saying "done" sent the operator
    // away believing leads had been added.
    back.searchParams.set("notice", "topup:unreadable response, check before retrying");
  }
  return NextResponse.redirect(back, 303);
}
