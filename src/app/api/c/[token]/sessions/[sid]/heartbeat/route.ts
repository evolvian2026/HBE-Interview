import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { handle, json } from "@/lib/http";
import { heartbeat } from "@/lib/interview/orchestrator";

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  await requireCandidateSession(token, sid);
  await heartbeat(sid);
  return json({ ok: true, serverNow: new Date().toISOString() });
});
