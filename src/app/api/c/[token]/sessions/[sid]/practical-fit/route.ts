import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { currentSection, type SessionState } from "@/lib/core/interview";
import { getSettings } from "@/lib/settings";

const Body = z.object({
  data: z.object({
    currentLocation: z.string().max(120),
    willingToRelocate: z.enum(["yes", "no", "depends", ""]),
    relocationNote: z.string().max(400).optional(),
    workModel: z.enum(["onsite", "hybrid", "remote", "flexible", ""]),
    noticeDays: z.number().int().min(0).max(365).nullable(),
    noticeNegotiable: z.boolean(),
    servingNotice: z.boolean(),
    earliestJoiningDate: z.string().max(20),
    expectedCompMin: z.number().min(0).nullable(),
    expectedCompMax: z.number().min(0).nullable(),
    compCurrency: z.string().max(8),
    compPreferLater: z.boolean(),
    otherOffers: z.enum(["yes", "no", "prefer_not", ""]),
    notes: z.string().max(1000).optional(),
  }),
});

/** Save the practical-details form (HR round). Confirmation happens via a "submitted" turn. */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  const { session, candidacy } = await requireCandidateSession(token, sid);
  if (session.status !== "active") throw new HttpError(409, "This round has ended");
  const sec = currentSection(session.state as SessionState);
  if (sec?.exercise !== "practical_fit") throw new HttpError(409, "The practical details form is not open");
  const { data } = Body.parse(await req.json());
  const settings = await getSettings();
  if (!settings.askCompensation) {
    data.expectedCompMin = null;
    data.expectedCompMax = null;
    data.compPreferLater = false;
  }
  await db
    .insert(schema.practicalFit)
    .values({ candidacyId: candidacy.id, data, confirmedAt: new Date() })
    .onConflictDoUpdate({ target: schema.practicalFit.candidacyId, set: { data, confirmedAt: new Date(), updatedAt: new Date() } });
  return json({ ok: true });
});
