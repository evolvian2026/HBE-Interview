import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, assertCandidacyAccess, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

/** Revoke a share link. */
export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  const [link] = await db.select().from(schema.shareLinks).where(eq(schema.shareLinks.id, id));
  if (!link) throw new HttpError(404, "Link not found");
  await assertCandidacyAccess(user, link.candidacyId);
  await db.update(schema.shareLinks).set({ revokedAt: new Date() }).where(eq(schema.shareLinks.id, id));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "share.revoke", "candidacy", link.candidacyId, { linkId: id });
  return json({ ok: true });
});
