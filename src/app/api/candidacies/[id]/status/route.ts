import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireStaff, assertCandidacyAccess } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/services/integrations";

const Body = z.object({ status: z.enum(["shortlisted", "rejected", "on_hold", "completed"]) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  await assertCandidacyAccess(user, id);
  const { status } = Body.parse(await req.json());
  await db.update(schema.candidacies).set({ stage: status, finalStatus: status, updatedAt: new Date() }).where(eq(schema.candidacies.id, id));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, `candidacy.${status}`, "candidacy", id);
  await emitEvent(user.orgId, "candidate.status_changed", { candidacyId: id, status });
  return json({ ok: true });
});
