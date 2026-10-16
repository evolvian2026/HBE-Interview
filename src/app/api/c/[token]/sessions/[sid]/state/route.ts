import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { handle, json } from "@/lib/http";
import { publicState } from "@/lib/interview/orchestrator";
import { loadSessionContext } from "@/lib/interview/load";
import { workspaceFor } from "@/lib/interview/exercises";

/** Full state for (re)connecting to the interview room. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  await requireCandidateSession(token, sid);
  const ctx = (await loadSessionContext(sid))!;
  const messages = await db
    .select({ id: schema.messages.id, seq: schema.messages.seq, role: schema.messages.role, content: schema.messages.content, sectionKey: schema.messages.sectionKey })
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sid))
    .orderBy(asc(schema.messages.seq));
  return json({
    state: publicState(ctx.session, ctx.state),
    messages: messages.filter((m) => m.role !== "system"),
    workspace: ctx.session.status === "active" ? await workspaceFor(ctx, ctx.state) : { kind: "none" },
    persona: ctx.round?.personaName,
    roundType: ctx.round?.type,
  });
});
