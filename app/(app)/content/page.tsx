import { redirect } from "next/navigation";
import { ContentBoard } from "@/components/content-board";
import { loadContent } from "@/lib/content-load";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ContentPage() {
  // The same data GET /api/content returns: the board keeps it up to date in
  // the background and redraws only the card that changed.
  const data = await loadContent();
  if (!data) redirect("/login");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Content</h1>
        <p className="text-sm text-slate-500">
          {data.isAdmin
            ? "Per client: what the engine learned, and every post (full text + image) with its reach and ICP-fit. Admins can approve, edit, request a revision, or suspend each post."
            : "Every post with its reach and engagement. Approve a post to schedule it, edit the text, request a text or image revision, upload your own image, or change the date."}
        </p>
      </header>
      <ContentBoard data={data} />
    </div>
  );
}
