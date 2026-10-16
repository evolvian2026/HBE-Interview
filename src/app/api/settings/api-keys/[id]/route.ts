import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

/** Revoke an API key (kept for audit; it stops authenticating immediately). */
export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  const [k] = await db.select({ id: schema.apiKeys.id }).from(schema.apiKeys).where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, user.orgId)));
  if (!k) throw new HttpError(404, "API key not found");
  await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, user.orgId), isNull(schema.apiKeys.revokedAt)));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "api_key.revoke", "api_key", id);
  return json({ ok: true });
});
