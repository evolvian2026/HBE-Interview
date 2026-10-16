import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export async function audit(
  actor: { type: "staff" | "candidate" | "system"; id?: string | null; orgId?: string | null },
  action: string,
  entity: string,
  entityId?: string | null,
  data?: unknown,
) {
  let orgId = actor.orgId ?? null;
  // Candidate and system actions are attributed to the organisation of the entity they touch.
  if (!orgId && entityId && /^[0-9a-f-]{36}$/i.test(entityId)) {
    if (entity === "candidacy") orgId = (await db.select({ o: schema.candidacies.orgId }).from(schema.candidacies).where(eq(schema.candidacies.id, entityId)))[0]?.o ?? null;
    else if (entity === "drive") orgId = (await db.select({ o: schema.drives.orgId }).from(schema.drives).where(eq(schema.drives.id, entityId)))[0]?.o ?? null;
  }
  await db.insert(schema.auditLog).values({
    orgId,
    actorType: actor.type,
    actorId: actor.id ?? null,
    action,
    entity,
    entityId: entityId ?? null,
    data: (data ?? null) as object | null,
  });
}
