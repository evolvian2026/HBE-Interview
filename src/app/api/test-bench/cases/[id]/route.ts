import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { deleteCase, updateCase } from "@/lib/services/benchmark";

const Rec = z.enum(["strong_hire", "hire", "lean_no", "no_hire"]);
const Body = z.object({
  title: z.string().max(160).optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  expected: z.object({ params: z.record(z.string(), z.number().int().min(1).max(5).nullable()), recommendation: Rec }).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireStaff("admin");
  await updateCase(user, (await params).id, Body.parse(await req.json()));
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireStaff("admin");
  await deleteCase(user, (await params).id);
  return json({ ok: true });
});
