import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/calling";
import { backTo, reasonOf, resolveActor, strategist } from "@/lib/calling-server";

const MAX_BYTES = 2 * 1024 * 1024; // 500 rows of contacts is far below this; Vercel caps bodies at ~4.5 MB
const MAX_ROWS = 500;

/**
 * POST /api/calling/upload  (multipart: file=<csv>, client=<slug>, label=<text>)
 * Parses the CSV here, hands the rows to the strategist, which enriches each with Apollo
 * and inserts them into the calling queue (stage paused, channel_state.calling.queued).
 */
export async function POST(req: NextRequest) {
  const who = await resolveActor();
  if ("error" in who) return who.error;
  const fd = await req.formData();
  const file = fd.get("file");
  const client = String(fd.get("client") ?? "").trim();
  const label = String(fd.get("label") ?? "upload").trim().replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "upload";
  const back = backTo(req);
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (!/^[a-z0-9_-]{1,64}$/.test(client)) return NextResponse.json({ error: "client required" }, { status: 400 });
  if (!who.isAdmin && client !== who.clientSlug) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });

  const rows = parseCsv(await file.text());
  if (!rows.length) {
    back.searchParams.set("notice", "upload:no_rows (header row + at least one contact needed)");
    return NextResponse.redirect(back, 303);
  }
  if (rows.length > MAX_ROWS) {
    back.searchParams.set("notice", `upload:too_many_rows (${rows.length}, max ${MAX_ROWS})`);
    return NextResponse.redirect(back, 303);
  }
  const res = await strategist(`/outreach/calling/${client}/upload`, { json: { rows, label, enrich: true } });
  if (!res.ok) {
    back.searchParams.set("notice", `upload:${reasonOf(res.text)}`);
    return NextResponse.redirect(back, 303);
  }
  try {
    const j = JSON.parse(res.text);
    back.searchParams.set("notice", `upload:added ${j.added}, duplicates ${j.duplicates}, enriched ${j.enriched}, failed ${j.failed}`);
  } catch {
    back.searchParams.set("notice", "upload:done");
  }
  return NextResponse.redirect(back, 303);
}
