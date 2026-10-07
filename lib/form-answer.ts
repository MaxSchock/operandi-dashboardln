import { NextResponse } from "next/server";

/** The dashboard's forms post with fetch and ask for JSON (components/action-form.tsx). */
export const wantsData = (req: Request) => (req.headers.get("accept") ?? "").includes("application/json");

/**
 * The answer to a form action that used to send the browser back to its page.
 * A plain form post still gets that 303. The dashboard's ActionForm gets the
 * same outcome as data: the reason when the page would have shown an error
 * (`?actionError=` or `?error=`), otherwise where the page would have gone, so
 * the form can show it on its own card and the page is not loaded again.
 */
export function answer(req: Request, back: URL | string) {
  const to = typeof back === "string" ? new URL(back, req.url) : back;
  if (!wantsData(req)) return NextResponse.redirect(to, 303);
  const error = to.searchParams.get("actionError") ?? to.searchParams.get("error");
  if (error) return NextResponse.json({ error }, { status: 409 });
  return NextResponse.json({ ok: true, to: to.pathname + to.search, notice: to.searchParams.get("notice") });
}
