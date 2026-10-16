import { db, schema } from "./db";

export async function audit(
  actor: { type: "staff" | "candidate" | "system"; id?: string | null },
  action: string,
  entity: string,
  entityId?: string | null,
  data?: unknown,
) {
  await db.insert(schema.auditLog).values({
    actorType: actor.type,
    actorId: actor.id ?? null,
    action,
    entity,
    entityId: entityId ?? null,
    data: (data ?? null) as object | null,
  });
}
