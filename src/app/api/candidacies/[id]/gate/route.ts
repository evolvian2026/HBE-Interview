import { z } from "zod";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { decideGate } from "@/lib/services/evaluation";

const Body = z.object({ decision: z.enum(["advance", "hold", "reject"]), reason: z.string().max(1000).optional() });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  const { decision, reason } = Body.parse(await req.json());
  try {
    await decideGate(id, decision, user.id, reason);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return json({ ok: true });
});
