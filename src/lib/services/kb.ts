import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chunkText, ftsQuery } from "../core/kb";

/** (Re)build the search passages of one knowledge-base document. */
export async function indexKbDocument(doc: { id: string; orgId: string; title: string; content: string }) {
  await db.delete(schema.kbChunks).where(eq(schema.kbChunks.documentId, doc.id));
  const chunks = chunkText(doc.content);
  if (chunks.length) await db.insert(schema.kbChunks).values(chunks.map((content, ord) => ({ orgId: doc.orgId, documentId: doc.id, ord, content })));
  return chunks.length;
}

/** Index any of the organisation's documents that have no passages yet (e.g. created before Phase 4). */
export async function ensureKbIndexed(orgId: string) {
  const missing = await db
    .select({ d: schema.kbDocuments })
    .from(schema.kbDocuments)
    .leftJoin(schema.kbChunks, eq(schema.kbChunks.documentId, schema.kbDocuments.id))
    .where(and(eq(schema.kbDocuments.orgId, orgId), isNull(schema.kbChunks.id)));
  for (const { d } of missing) await indexKbDocument(d);
  return missing.length;
}

export interface KbPassage {
  title: string;
  content: string;
  rank: number;
}

/** Top passages of the organisation's knowledge base for a free-text question (Postgres full-text search). */
export async function searchKb(orgId: string, question: string, limit = 5): Promise<KbPassage[]> {
  const q = ftsQuery(question);
  if (!q) return [];
  const doc = sql`to_tsvector('simple', ${schema.kbChunks.content})`;
  const query = sql`to_tsquery('simple', ${q})`;
  const rows = await db
    .select({ title: schema.kbDocuments.title, content: schema.kbChunks.content, rank: sql<number>`ts_rank(${doc}, ${query})` })
    .from(schema.kbChunks)
    .innerJoin(schema.kbDocuments, eq(schema.kbChunks.documentId, schema.kbDocuments.id))
    .where(and(eq(schema.kbChunks.orgId, orgId), sql`${doc} @@ ${query}`))
    .orderBy(sql`ts_rank(${doc}, ${query}) desc`, asc(schema.kbChunks.ord))
    .limit(limit);
  return rows.map((r) => ({ ...r, rank: Number(r.rank) }));
}
