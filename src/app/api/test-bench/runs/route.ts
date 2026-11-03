import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { startRun } from "@/lib/services/benchmark";

const Body = z.object({ label: z.string().max(120).optional(), model: z.string().max(80).optional(), repeats: z.number().int().min(1).max(3).optional() });

/** Re-score every active test case with the current evaluator model, or with a model being tried. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const b = Body.parse(await req.json());
  await limit(`bench-run:${user.orgId}`, 20, 24 * 3600, "That's a lot of test runs today — please try again tomorrow.");
  const run = await startRun(user.orgId, user, b);
  return json({ id: run.id }, 201);
});
