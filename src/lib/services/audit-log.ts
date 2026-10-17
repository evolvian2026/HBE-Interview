import { and, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db";
import { csvCell } from "../csv";

export const AUDIT_CATEGORIES = ["auth", "user", "drive", "candidacy", "consent", "round", "report", "gate", "feedback", "share", "resume", "problem", "settings", "api_key", "webhook", "org", "data"] as const;

export interface AuditFilter {
  category?: string;
  actorId?: string;
  days?: number | null;
  q?: string;
}

function where(orgId: string, f: AuditFilter): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(schema.auditLog.orgId, orgId)];
  if (f.category && (AUDIT_CATEGORIES as readonly string[]).includes(f.category)) conds.push(ilike(schema.auditLog.action, `${f.category}.%`));
  if (f.actorId) conds.push(eq(schema.auditLog.actorId, f.actorId));
  if (f.days) conds.push(gte(schema.auditLog.createdAt, new Date(Date.now() - f.days * 86_400_000)));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(schema.auditLog.entityId, like), ilike(schema.auditLog.action, like), sql`${schema.auditLog.data}::text ilike ${like}`));
  }
  return and(...conds);
}

/** An organisation's audit trail, newest first, with the acting staff member's name where there is one. */
export async function queryAudit(orgId: string, f: AuditFilter, limit = 100, offset = 0) {
  const rows = await db
    .select({ a: schema.auditLog, actorName: schema.users.name, actorEmail: schema.users.email })
    .from(schema.auditLog)
    .leftJoin(schema.users, and(eq(schema.auditLog.actorType, "staff"), sql`${schema.auditLog.actorId} = ${schema.users.id}::text`))
    .where(where(orgId, f))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit + 1)
    .offset(offset);
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

export async function auditCsv(orgId: string, f: AuditFilter) {
  const { rows } = await queryAudit(orgId, f, 50_000);
  const head = ["time", "actor_type", "actor", "action", "entity", "entity_id", "data"];
  const lines = rows.map(({ a, actorName, actorEmail }) =>
    [a.createdAt.toISOString(), a.actorType, actorEmail ? `${actorName} <${actorEmail}>` : (a.actorId ?? ""), a.action, a.entity, a.entityId ?? "", a.data].map(csvCell).join(","),
  );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
