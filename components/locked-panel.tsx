import { Lock } from "lucide-react";
import { Card, CardBody } from "@/components/ui";

const COPY = {
  leads: {
    title: "Lead pipeline is not part of your plan",
    body: "Operandi runs a done-for-you LinkedIn outreach system: we identify decision makers that match your ideal customer profile, start conversations in your name and hand you qualified leads, with every reply managed 24/7. This page is where those leads would live.",
  },
  engagement: {
    title: "Warm engagement is not part of your plan",
    body: "Warm DMs turns the people who engage with your content into conversations. We detect who liked or commented on your posts, qualify them against your target profile and draft personal messages for approval. It is the natural next step once your content is performing.",
  },
} as const;

/**
 * Upsell panel shown to content-only clients on outreach pages. The page
 * rendering this must NOT fetch any outreach data for these users.
 */
export function LockedPanel({ feature }: { feature: keyof typeof COPY }) {
  const c = COPY[feature];
  return (
    <Card>
      <CardBody>
        <div className="grid place-items-center px-6 py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100">
            <Lock className="h-5 w-5 text-slate-500" />
          </div>
          <h2 className="mt-4 font-display text-lg text-navy">{c.title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{c.body}</p>
          <p className="mt-4 text-sm font-medium text-electric">
            Interested? Ask Max about adding this to your plan.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
