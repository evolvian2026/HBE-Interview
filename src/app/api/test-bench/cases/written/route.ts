import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { writtenCase } from "@/lib/services/benchmark";

const Rec = z.enum(["strong_hire", "hire", "lean_no", "no_hire"]);
const Body = z.object({
  title: z.string().trim().min(3).max(160),
  driveId: z.string().uuid(),
  roundType: z.enum(["technical", "managerial", "hr"]),
  transcript: z.string().min(20).max(60_000),
  exercise: z.string().max(20_000).optional(),
  expected: z.object({ params: z.record(z.string(), z.number().int().min(1).max(5).nullable()), recommendation: Rec }),
  notes: z.string().max(2000).optional(),
});

/** A test case written from scratch (no candidate data). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const c = await writtenCase(user, Body.parse(await req.json()));
  return json({ id: c.id }, 201);
});
