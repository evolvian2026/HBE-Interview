import { z } from "zod";
import { candidacyByToken } from "@/lib/auth/candidate";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { setPoolConsent } from "@/lib/services/talent";

const Body = z.object({ months: z.number().int().nullable() });

/** The candidate joins (months) or leaves (null) the organisation's talent pool. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const row = await candidacyByToken(token); // leaving must work even after the process closed
  if (!row || ["invited", "declined"].includes(row.candidacy.stage)) throw new HttpError(404, "This link is not valid");
  await limit(`pool:${row.candidacy.id}`, 20, 60 * 60);
  const expires = await setPoolConsent(row.candidacy, Body.parse(await req.json()).months);
  return json({ expiresAt: expires?.toISOString() ?? null });
});
