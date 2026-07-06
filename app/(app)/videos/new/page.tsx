import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, EmptyState } from "@/components/ui";
import { getTier } from "@/lib/tier";
import { resolveVideoActor } from "@/lib/videos";
import { VideoWizard } from "@/components/video-wizard";

export const dynamic = "force-dynamic";

export default async function NewVideoPage() {
  const tier = await getTier();
  if (!tier.videoEnabled) redirect("/dashboard");

  // The acting client's features (admins act for the scoped client).
  const { actor, error } = await resolveVideoActor();
  if (!actor) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <header><h1 className="font-display text-2xl text-navy">New video request</h1></header>
        <Card><CardBody><EmptyState title="Cannot create a video here" hint={error} /></CardBody></Card>
      </div>
    );
  }

  // Upcoming calendar posts the video can be linked to (RLS keeps this to the
  // caller's own client; admins see the scoped/all list which is fine).
  const sb = await createClient();
  const { data } = await sb
    .from("content_calendar")
    .select("post_id, text_content, scheduled_for")
    .is("published_at", null)
    .order("scheduled_for", { ascending: true })
    .limit(12);
  const linkedPosts = (data ?? []).map((p: { post_id: string; text_content: string | null; scheduled_for: string | null }) => ({
    id: p.post_id,
    label: `${p.scheduled_for ? new Date(p.scheduled_for).toLocaleDateString() : "unscheduled"} · ${(p.text_content ?? "").slice(0, 60)}`,
  }));

  const voiceAvailable = !!actor.features.voice_consent_at;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/videos" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3 w-3" /> Back to videos
        </Link>
      </div>
      <header>
        <h1 className="font-display text-2xl text-navy">New video request</h1>
        <p className="text-sm text-slate-500">
          You have 1 video (up to {actor.features.video_max_duration_s} seconds) per week.
          Free edits are unlimited; a full regeneration is available once per video.
        </p>
      </header>
      <Card>
        <CardHeader title="Brief" hint="the more specific, the better the storyboard" />
        <CardBody>
          <VideoWizard
            maxDurationS={actor.features.video_max_duration_s}
            voiceAvailable={voiceAvailable}
            linkedPosts={linkedPosts}
          />
        </CardBody>
      </Card>
    </div>
  );
}
