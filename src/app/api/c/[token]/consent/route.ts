import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { recordConsent } from "@/lib/services/candidacy";
import { getSettings } from "@/lib/settings";

const Body = z.object({ accept: z.boolean() });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  if (candidacy.stage !== "invited") throw new HttpError(409, "Consent was already recorded");
  const s = await getSettings();
  const { accept } = Body.parse(await req.json());
  await recordConsent(candidacy.id, accept, s.consentText, s.consentVersion, {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: req.headers.get("user-agent"),
  });
  return json({ ok: true });
});
