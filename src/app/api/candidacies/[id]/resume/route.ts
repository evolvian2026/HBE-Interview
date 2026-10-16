import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff, assertCandidacyAccess } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { audit } from "@/lib/audit";

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("viewer");
  const { id } = await params;
  await assertCandidacyAccess(user, id);
  const [r] = await db.select().from(schema.resumes).where(eq(schema.resumes.candidacyId, id));
  if (!r) throw new HttpError(404, "No resume");
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "resume.download", "candidacy", id);
  return new Response(new Uint8Array(r.fileData), {
    headers: { "content-type": r.mimeType, "content-disposition": `attachment; filename="${r.fileName.replace(/[^\w.-]/g, "_")}"` },
  });
});
