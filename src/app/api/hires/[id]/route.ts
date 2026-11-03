import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { markDeclined, markJoined, markLeft } from "@/lib/services/hires";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("joined"), joinedAt: z.coerce.date(), managerId: z.string().uuid() }),
  z.object({ action: z.literal("declined") }),
  z.object({ action: z.literal("left"), leftAt: z.coerce.date(), reason: z.enum(["resigned", "let_go", "other"]) }),
]);

/** Recruiters record what happened after the offer: joined (with the manager who will review), declined, or left. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  const b = Body.parse(await req.json());
  if (b.action === "joined") await markJoined(user, id, b);
  else if (b.action === "declined") await markDeclined(user, id);
  else await markLeft(user, id, b);
  return json({ ok: true });
});
