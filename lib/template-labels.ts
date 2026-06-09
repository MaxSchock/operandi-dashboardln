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
  /**
   * What the body field means for THIS template:
   *  - "needed":             empty body == draft / missing copy
   *  - "intentionally_bare": empty body == design (bare connection request)
   *  - "variants_only":      body is ignored, the variants array is what's sent
   */
  bodyMode: "needed" | "intentionally_bare" | "variants_only";
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
      bodyMode: "variants_only",
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
          "`cold_invite_no_note` strategy. No text is shown to the prospect.",
        bodyMode: "intentionally_bare",
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
        bodyMode: "intentionally_bare",
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
        bodyMode: "needed",
      };
    }
    return {
      channelLabel: ch,
      title: `Invite — ${arm_key ?? "default"}`,
      when: "LinkedIn connection request body for this bandit arm.",
      bodyMode: "needed",
    };
  }

  // LinkedIn message sequence — msg_1, msg_2, msg_3
  if (stage === "act_li_message") {
    if (arm_key === "msg_1" || !arm_key) {
      return {
        channelLabel: ch,
        title: "First LinkedIn message after the invite is accepted",
        when:
          "Sent 48 hours after the prospect accepts the connection request, " +
          "regardless of which invite arm got them in. The system's opening line " +
          "in the chat.",
        bodyMode: "needed",
      };
    }
    if (arm_key === "msg_2") {
      return {
        channelLabel: ch,
        title: "LinkedIn follow-up #2 (relance)",
        when:
          "Sent 3–4 days after the first message if the prospect hasn't replied. " +
          "Introduces the brand for the first time with a soft 'pattern' framing.",
        bodyMode: "needed",
      };
    }
    if (arm_key === "msg_3") {
      return {
        channelLabel: ch,
        title: "LinkedIn follow-up #3 (final relance)",
        when:
          "Sent 4–5 days after msg_2 if still no reply. Last attempt on LinkedIn " +
          "before the lead either gets the email bridge or is archived.",
        bodyMode: "needed",
      };
    }
    return {
      channelLabel: ch,
      title: `LinkedIn message — ${arm_key}`,
      when: "Outbound message inside an existing LinkedIn chat.",
      bodyMode: "needed",
    };
  }

  // Email sequence — email_1 (bridge after LI silent), email_2 (final nudge)
  if (stage === "act_email_send") {
    if (arm_key === "email_1") {
      return {
        channelLabel: ch,
        title: "Email bridge after LinkedIn goes silent",
        when:
          "Sent ~7 days after msg_3 with no reply on LinkedIn. Explicit channel " +
          "switch — short subject line + body that names the LinkedIn touch and " +
          "moves the offer into the inbox.",
        bodyMode: "needed",
      };
    }
    if (arm_key === "email_2") {
      return {
        channelLabel: ch,
        title: "Final email nudge",
        when:
          "Sent 5–6 days after email_1 with no reply. Soft close: no pressure, " +
          "stays available. After this, the lead is archived.",
        bodyMode: "needed",
      };
    }
    return {
      channelLabel: ch,
      title: arm_key ? `Cold email — ${arm_key}` : "Cold email",
      when: "Sent via the client's mailbox in the email follow-up sequence.",
      bodyMode: "needed",
    };
  }

  return {
    channelLabel: ch,
    title: arm_key ? `${stage} — ${arm_key}` : stage,
    when: "No description for this combination yet.",
    bodyMode: "needed",
  };
}
