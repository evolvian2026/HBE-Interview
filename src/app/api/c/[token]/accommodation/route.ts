import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { requestAccommodation } from "@/lib/services/accommodations";
import { EXTRA_TIME_OPTIONS } from "@/lib/core/calibration";

const Body = z.object({
  extraTimePct: z.number().int().refine((n) => (EXTRA_TIME_OPTIONS as readonly number[]).includes(n), "Choose one of the offered amounts of extra time"),
  extraBreaks: z.boolean(),
  details: z.string().max(2000).optional(),
});

/** The candidate asks for interview adjustments (extra time, extra breaks, anything else they describe). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  await limit(`accommodation:${candidacy.id}`, 10, 60 * 60);
  await requestAccommodation(candidacy, Body.parse(await req.json()));
  return json({ ok: true }, 201);
});
