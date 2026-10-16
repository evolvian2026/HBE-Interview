import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireApiKey } from "@/lib/services/integrations";
import { inviteCandidates } from "@/lib/services/candidacy";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/drives/{id}/candidates — candidates in a drive with stage and final result (scope candidates:read). */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const key = await requireApiKey(req, "candidates:read");
  const { id } = await params;
  const rows = await db
    .select({
      id: schema.candidacies.id,
      name: schema.candidates.name,
      email: schema.candidates.email,
      stage: schema.candidacies.stage,
      finalStatus: schema.candidacies.finalStatus,
      finalScore: schema.combinedReports.finalScore,
      recommendation: schema.combinedReports.recommendation,
      createdAt: schema.candidacies.createdAt,
      updatedAt: schema.candidacies.updatedAt,
    })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .leftJoin(schema.combinedReports, eq(schema.combinedReports.candidacyId, schema.candidacies.id))
    .where(and(eq(schema.candidacies.driveId, id), eq(schema.candidacies.orgId, key.orgId)))
    .orderBy(desc(schema.candidacies.createdAt));
  return json({ data: rows });
});

const Body = z.object({
  candidates: z.array(z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().max(320) })).min(1).max(200),
});

/** POST /api/v1/drives/{id}/candidates — invite candidates; returns each personal link (scope candidates:write). */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const key = await requireApiKey(req, "candidates:write");
  const { id } = await params;
  const { candidates } = Body.parse(await req.json());
  const results = await inviteCandidates(id, candidates, { id: key.createdBy, orgId: key.orgId }, "api");
  return json({ data: results }, 201);
});
