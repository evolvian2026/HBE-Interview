import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { inviteCandidates } from "@/lib/services/candidacy";

const Body = z.object({ candidates: z.array(z.object({ name: z.string(), email: z.string() })).min(1).max(200), source: z.enum(["invite", "csv"]).default("invite") });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const body = Body.parse(await req.json());
  return json({ results: await inviteCandidates(id, body.candidates, user, "ui", body.source) });
});
