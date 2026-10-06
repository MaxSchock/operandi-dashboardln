import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient, serviceRoleClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody, EmptyState } from "@/components/ui";
import { getTier } from "@/lib/tier";
import { resolveVideoActor } from "@/lib/videos";
import { VideoWizard } from "@/components/video-wizard";
import { VideoRequestSimple } from "@/components/video-request-simple";
import type { MonthSpend } from "@/components/video-pay";

export const dynamic = "force-dynamic";

export default async function NewVideoPage({ searchParams }: { searchParams: Promise<{ advanced?: string }> }) {
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
  // Clients write one text and the agent picks the style (2026-09-30). The
  // detailed form (style, lines, recordings per line) stays for admins.
  const advanced = tier.isAdmin && (await searchParams).advanced === "1";

  // People who can appear in a dialogue: the client's approved character sheets.
  const { data: chars } = await serviceRoleClient().from("video_characters")
    .select("name, voice_sample_key, version").eq("client_slug", actor.clientSlug).eq("status", "approved")
    .order("version", { ascending: false });
  const characters: { name: string; hasVoice: boolean }[] = [];
  for (const c of (chars ?? []) as { name: string; voice_sample_key: string | null }[]) {
    if (!characters.some(x => x.name === c.name)) characters.push({ name: c.name, hasVoice: !!c.voice_sample_key && voiceAvailable });
  }

  let spend: MonthSpend | null = null;
  if (actor.features.video_staged_flow) {
    const { data: m } = await serviceRoleClient().rpc("video_month_spend", { p_client: actor.clientSlug });
    spend = (m as MonthSpend | null) ?? null;
  }

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
        <CardHeader title={advanced ? "Detailed brief (admin)" : "Your video"} hint="the more specific, the better the storyboard" />
        <CardBody>
          {advanced ? (
            <VideoWizard
              maxDurationS={actor.features.video_max_duration_s}
              voiceAvailable={voiceAvailable}
              linkedPosts={linkedPosts}
              keyframeReview={actor.features.video_keyframe_review}
              characters={characters}
            />
          ) : (
            <VideoRequestSimple
              maxDurationS={actor.features.video_max_duration_s}
              linkedPosts={linkedPosts}
              characters={characters.map(c => c.name)}
              keyframeReview={actor.features.video_keyframe_review}
              staged={actor.features.video_staged_flow}
              spend={spend}
            />
          )}
        </CardBody>
      </Card>
      {tier.isAdmin && (
        <Link href={advanced ? "/videos/new" : "/videos/new?advanced=1"} className="text-xs text-slate-500 hover:text-slate-700">
          {advanced ? "Client form (one text, the agent picks the style)" : "Admin: detailed form (style, lines, recordings)"}
        </Link>
      )}
    </div>
  );
}
