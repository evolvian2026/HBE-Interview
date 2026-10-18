/** Client-safe integration constants (no DB imports — see settings-shared.ts for the same pattern). */
export const API_SCOPES = ["drives:read", "candidates:read", "candidates:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const WEBHOOK_EVENTS = [
  "candidate.invited",
  "round.completed",
  "round.evaluated",
  "gate.decided",
  "candidate.completed",
  "candidate.status_changed",
  "panel.scheduled",
  "candidate.decided",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
