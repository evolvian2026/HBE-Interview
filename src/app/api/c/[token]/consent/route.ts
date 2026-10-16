import { z } from "zod";
import { requireCandidacy } from "@/lib/auth/candidate";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { recordConsent } from "@/lib/services/candidacy";
import { getSettings } from "@/lib/settings";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DriveConfig } from "@/lib/core/types";

const Body = z.object({ accept: z.boolean(), webcam: z.boolean().optional() });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const { candidacy } = await requireCandidacy(token);
  if (candidacy.stage !== "invited") throw new HttpError(409, "Consent was already recorded");
  const s = await getSettings(candidacy.orgId);
  const { accept, webcam } = Body.parse(await req.json());
  const [v] = await db.select({ config: schema.driveVersions.config }).from(schema.driveVersions).where(eq(schema.driveVersions.id, candidacy.driveVersionId));
  if (accept && (v.config as DriveConfig).proctoring?.webcam && !webcam) throw new HttpError(400, "This interview uses webcam proctoring — please consent to webcam snapshots to continue.");
  await recordConsent(candidacy.id, accept, s.consentText, s.consentVersion, {
    webcam: !!webcam,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: req.headers.get("user-agent"),
  });
  return json({ ok: true });
});
