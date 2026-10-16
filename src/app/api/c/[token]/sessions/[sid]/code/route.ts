import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { currentSection, type SessionState } from "@/lib/core/interview";
import { getProblem } from "@/lib/services/problems";
import { executeTests } from "@/lib/exec";

const Body = z.object({ action: z.enum(["run", "submit", "snapshot"]), language: z.enum(["python", "javascript", "java", "cpp"]), code: z.string().max(64 * 1024) });

const lastRun = new Map<string, number>();

/** Run sample tests, submit against hidden tests, or store a snapshot of the editor. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  const { session } = await requireCandidateSession(token, sid);
  if (session.status !== "active") throw new HttpError(409, "This round has ended");
  const { action, language, code } = Body.parse(await req.json());
  const state = session.state as SessionState;
  const sec = currentSection(state);
  const ex = sec ? state.exercises[sec.key] : undefined;
  if (!ex || ex.kind !== "coding") throw new HttpError(409, "No coding exercise is open right now");
  if (ex.submittedAt && action !== "snapshot") throw new HttpError(409, "You have already submitted this solution");
  const p = (await getProblem(ex.refId))!;
  if (action === "snapshot") {
    await db.insert(schema.codeRuns).values({ sessionId: sid, problemId: p.id, kind: "snapshot", language, code });
    return json({ ok: true });
  }
  const prev = lastRun.get(sid) ?? 0;
  if (Date.now() - prev < 3000) throw new HttpError(429, "Please wait a moment between runs");
  lastRun.set(sid, Date.now());
  const results = await executeTests(language, code, action === "run" ? p.samples : p.hidden, { revealIO: action === "run" });
  await db.insert(schema.codeRuns).values({ sessionId: sid, problemId: p.id, kind: action, language, code, results });
  return json({ results });
});
