import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { caseFromReport, casesFromCalibration } from "@/lib/services/benchmark";

const Body = z.union([z.object({ reportId: z.string().uuid() }), z.object({ fromCalibration: z.literal(true) })]);

/** Add an evaluated round to the test bench, or every round with a blind review that isn't in it yet. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const b = Body.parse(await req.json());
  if ("reportId" in b) {
    const c = await caseFromReport(user, b.reportId);
    return json({ id: c.id }, 201);
  }
  return json(await casesFromCalibration(user));
});
