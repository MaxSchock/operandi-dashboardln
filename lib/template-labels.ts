/**
 * Maps a (channel, stage, arm_key) tuple to a human-friendly title and
 * a short explanation of WHEN the system actually uses that template.
 * Used by /templates and /templates/[id]/edit so the operator doesn't
 * have to remember the schema column names.
 */

export type TemplateKey = {
  channel: string;
  stage: string;
  arm_key: string | null;
};

export type TemplateLabel = {
  title: string;
  when: string;            // one-liner: "Sent when …"
  channelLabel: string;    // "LinkedIn" / "Email" / "Voice" …
};

const CHANNEL_LABELS: Record<string, string> = {
  li: "LinkedIn",
  email: "Email",
  voice: "Voice",
  wa: "WhatsApp",
};

export function labelFor({ channel, stage, arm_key }: TemplateKey): TemplateLabel {
  const ch = CHANNEL_LABELS[channel] ?? channel;

  // LinkedIn — engage post (comment dropped before the invite)
  if (stage === "act_li_engage_post") {
    return {
      channelLabel: ch,
      title: "Comment under the prospect's recent post",
      when:
        "Sent 60–180 minutes after the system likes the prospect's most recent post, " +
        "only when the bandit picks the `engage_then_invite_no_note` strategy. " +
        "If multiple variants are filled in, one is chosen at random per send. " +
        "Comments must not mention the brand.",
    };
  }

  // LinkedIn invite
  if (stage === "act_li_invite") {
    if (arm_key === "cold_invite_no_note") {
      return {
        channelLabel: ch,
        title: "Cold invite — no note attached",
        when:
          "Sent as a bare connection request when the bandit picks the " +
          "`cold_invite_no_note` strategy. Body is intentionally empty.",
      };
    }
    if (arm_key === "engage_then_invite_no_note") {
      return {
        channelLabel: ch,
        title: "Invite after engaging the post — no note",
        when:
          "Sent ~60 minutes after the comment under the prospect's post, " +
          "when the bandit picks the `engage_then_invite_no_note` strategy. " +
          "Also without a note (the post engagement does the warming up).",
      };
    }
    if (arm_key === "invite_with_note_300") {
      return {
        channelLabel: ch,
        title: "Invite with a short personalised note (≤300 chars)",
        when:
          "Sent as a connection request with this note attached, when the bandit " +
          "picks the `invite_with_note_300` strategy. Max 300 characters; longer " +
          "bodies are truncated by Unipile.",
      };
    }
    return {
      channelLabel: ch,
      title: `Invite — ${arm_key ?? "default"}`,
      when: "LinkedIn connection request body for this bandit arm.",
    };
  }

  // LinkedIn first message after accept
  if (stage === "act_li_message") {
    if (!arm_key) {
      return {
        channelLabel: ch,
        title: "First message after the prospect accepts the invite",
        when:
          "Sent 48 hours after the prospect accepts the connection request, " +
          "regardless of which invite arm got them in. This is the system's " +
          "opening message in the chat.",
      };
    }
    return {
      channelLabel: ch,
      title: `Follow-up message — ${arm_key}`,
      when: "Outbound message inside an existing LinkedIn chat.",
    };
  }

  // Email send (V2+, not used today but documented)
  if (stage === "act_email_send") {
    return {
      channelLabel: ch,
      title: arm_key ? `Cold email — ${arm_key}` : "Cold email",
      when:
        "Sent via the client's mailbox when the channel-next bandit picks email after LinkedIn stalled.",
    };
  }

  return {
    channelLabel: ch,
    title: arm_key ? `${stage} — ${arm_key}` : stage,
    when: "No description for this combination yet.",
  };
}
