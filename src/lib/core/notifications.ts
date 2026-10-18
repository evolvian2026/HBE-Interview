/** Team notifications to Slack / Microsoft Teams incoming webhooks (pure: events, URL rules, payloads). */

export const CHANNEL_EVENTS = {
  "decision.needed": "A round is finished and needs a decision",
  "candidate.completed": "A candidate finished all AI rounds",
  "panel.feedback_complete": "Every panel scorecard is in",
  "candidate.decided": "A final decision was recorded",
  "accommodation.requested": "A candidate asked for interview adjustments",
  "panel.reschedule_requested": "A candidate asked to reschedule a panel interview",
  "calibration.disagreement": "A blind review disagreed with the AI",
} as const;

export type ChannelEvent = keyof typeof CHANNEL_EVENTS;
export const CHANNEL_EVENT_KEYS = Object.keys(CHANNEL_EVENTS) as ChannelEvent[];
export type ChannelKind = "slack" | "teams";

export interface ChannelMessage {
  title: string;
  text: string;
  link: string;
}

const TEAMS_HOSTS = [/\.webhook\.office\.com$/i, /\.logic\.azure\.com$/i, /\.powerplatform\.com$/i, /\.environment\.api\.powerplatform\.com$/i];

/** In production, a channel URL must be HTTPS on the provider's webhook host. */
export function channelUrlProblem(kind: ChannelKind, raw: string, production: boolean): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "That isn't a valid URL.";
  }
  if (!["http:", "https:"].includes(u.protocol)) return "The URL must start with https://";
  if (!production) return null;
  if (u.protocol !== "https:") return "The URL must use HTTPS.";
  if (kind === "slack" && u.hostname !== "hooks.slack.com") return "Slack incoming webhook URLs start with https://hooks.slack.com/";
  if (kind === "teams" && !TEAMS_HOSTS.some((r) => r.test(u.hostname))) return "Use the incoming webhook or Workflows URL Microsoft Teams gives you (…webhook.office.com or …logic.azure.com).";
  return null;
}

/** Slack's mrkdwn treats &, < and > as control characters. */
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function channelPayload(kind: ChannelKind, m: ChannelMessage): Record<string, unknown> {
  if (kind === "slack") {
    return {
      text: `${m.title}: ${m.text}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${slackEscape(m.title)}*\n${slackEscape(m.text)}` } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in HBE Interview" }, url: m.link }] },
      ],
    };
  }
  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: m.title,
    themeColor: "4F46E5",
    title: m.title,
    text: m.text,
    potentialAction: [{ "@type": "OpenUri", name: "Open in HBE Interview", targets: [{ os: "default", uri: m.link }] }],
  };
}
