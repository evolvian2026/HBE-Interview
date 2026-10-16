import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { HttpError } from "@/lib/auth/staff";
import { requireApiKey } from "@/lib/services/integrations";
import { candidateRounds } from "@/lib/services/candidacy";
import type { DriveConfig } from "@/lib/core/types";

/** GET /api/v1/candidates/{candidacyId} — stage, per-round status/scores and the final result (scope candidates:read). */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireApiKey(req, "candidates:read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Candidate not found");
  const [row] = await db
    .select({ c: schema.candidacies, cand: schema.candidates, v: schema.driveVersions })
    .from(schema.candidacies)
    .innerJoin(schema.candidates, eq(schema.candidacies.candidateId, schema.candidates.id))
    .innerJoin(schema.driveVersions, eq(schema.candidacies.driveVersionId, schema.driveVersions.id))
    .where(eq(schema.candidacies.id, id));
  if (!row) throw new HttpError(404, "Candidate not found");
  const rounds = await candidateRounds(row.c, row.v.config as DriveConfig);
  const reports = await db.select().from(schema.roundReports).where(eq(schema.roundReports.candidacyId, id)).orderBy(asc(schema.roundReports.roundIndex));
  const gates = await db.select().from(schema.gateDecisions).where(eq(schema.gateDecisions.candidacyId, id)).orderBy(asc(schema.gateDecisions.createdAt));
  const [combined] = await db.select().from(schema.combinedReports).where(eq(schema.combinedReports.candidacyId, id));
  return json({
    data: {
      id: row.c.id,
      driveId: row.c.driveId,
      driveVersion: row.v.version,
      candidate: { name: row.cand.name, email: row.cand.email },
      stage: row.c.stage,
      finalStatus: row.c.finalStatus,
      rounds: rounds.map((r) => {
        const rep = reports.find((x) => x.roundIndex === r.index);
        return {
          index: r.index,
          type: r.type,
          status: r.status,
          report: rep
            ? { status: rep.status, score: rep.roundScore, recommendation: rep.recommendation, confidence: rep.confidence, summary: rep.summary }
            : null,
        };
      }),
      gates: gates.map((g) => ({ fromRoundIndex: g.fromRoundIndex, decision: g.decision, mode: g.mode, at: g.createdAt })),
      result:
        combined?.status === "ready"
          ? { finalScore: combined.finalScore, recommendation: combined.recommendation, confidence: combined.confidence, partial: combined.partial }
          : null,
      createdAt: row.c.createdAt,
      updatedAt: row.c.updatedAt,
    },
  });
});
