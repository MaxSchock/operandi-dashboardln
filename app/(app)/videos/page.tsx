import { redirect } from "next/navigation";
import { Card, CardBody, EmptyState } from "@/components/ui";
import { getTier } from "@/lib/tier";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const tier = await getTier();
  if (!tier.videoEnabled) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-navy">Videos</h1>
        <p className="text-sm text-slate-500">
          Request short videos for your LinkedIn feed. One video of up to 15 seconds per week.
        </p>
      </header>
      <Card>
        <CardBody>
          <EmptyState
            title="Video requests are almost ready"
            hint="This is where you will brief a video, approve its storyboard and review the result."
          />
        </CardBody>
      </Card>
    </div>
  );
}
