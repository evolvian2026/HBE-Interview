import type { Tone } from "./ui";
import type { Recommendation } from "@/lib/core/types";

export const STAGE_LABEL: Record<string, string> = {
  invited: "Invited",
  declined: "Declined consent",
  onboarding: "Profile in progress",
  ready: "Ready for round",
  round_available: "Next round available",
  in_round: "In a round",
  evaluating: "Evaluating",
  gate_pending: "Awaiting decision",
  on_hold: "On hold",
  completed: "Completed",
  shortlisted: "Shortlisted",
  panel: "Panel interview",
  offer: "Offer",
  rejected: "Rejected",
  expired: "Expired",
};

export const STAGE_TONE: Record<string, Tone> = {
  gate_pending: "amber",
  completed: "blue",
  shortlisted: "green",
  panel: "blue",
  offer: "green",
  rejected: "red",
  expired: "slate",
  declined: "slate",
  on_hold: "amber",
};

export const REC_TONE: Record<Recommendation, Tone> = { strong_hire: "green", hire: "green", lean_no: "amber", no_hire: "red" };

export const FIT_TONE: Record<string, Tone> = { match: "green", negotiable: "amber", mismatch: "red", unknown: "slate" };
