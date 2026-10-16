import { z } from "zod";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { handle, json } from "@/lib/http";
import { controlSession } from "@/lib/interview/orchestrator";

const Body = z.object({ action: z.enum(["pause", "resume"]) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  await requireCandidateSession(token, sid);
  return json({ state: await controlSession(sid, Body.parse(await req.json()).action) });
});
