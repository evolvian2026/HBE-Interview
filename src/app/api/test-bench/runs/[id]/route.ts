import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { cancelRun, setBaseline } from "@/lib/services/benchmark";

const Body = z.object({ action: z.enum(["cancel", "baseline"]) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  const { action } = Body.parse(await req.json());
  if (action === "cancel") await cancelRun(user, id);
  else await setBaseline(user, id);
  return json({ ok: true });
});
