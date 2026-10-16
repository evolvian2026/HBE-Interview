import { z } from "zod";
import { structured, type CallContext } from "./gateway";

export const PresenceSchema = z.object({
  personCount: z.number(),
  faceVisible: z.boolean(),
  phoneOrSecondScreenVisible: z.boolean(),
  note: z.string(),
});
export type PresenceCheck = z.infer<typeof PresenceSchema>;

/**
 * Presence check on a webcam snapshot (K-7). Counts people and notes obvious aids; it does NOT identify anyone
 * and never compares faces (no biometric identification).
 */
export async function checkPresence(jpeg: Buffer, ctx: CallContext): Promise<PresenceCheck> {
  return structured({
    stage: "proctor_presence",
    tier: "utility",
    system:
      "You review a single low-resolution webcam frame from a remote interview. Report only: how many people are visible, whether a face is visible to the camera, and whether a phone or another screen facing the candidate is clearly visible. Do not identify, describe or infer anything about the person's identity, appearance, age, gender, ethnicity, health or surroundings beyond these facts. note: one short neutral sentence.",
    user: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
      { type: "text", text: "Assess this frame." },
    ],
    schema: PresenceSchema,
    maxTokens: 300,
    ctx,
    mock: () => ({ personCount: 1, faceVisible: true, phoneOrSecondScreenVisible: false, note: "Mock: one person visible." }),
  });
}

export function presenceFlagged(c: PresenceCheck) {
  return c.personCount !== 1 || !c.faceVisible || c.phoneOrSecondScreenVisible;
}
