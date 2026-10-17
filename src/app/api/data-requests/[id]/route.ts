import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { declineDeletion, fulfilDeletion } from "@/lib/services/data-rights";

const Body = z.discriminatedUnion("action", [z.object({ action: z.literal("delete") }), z.object({ action: z.literal("decline"), reason: z.string().trim().min(10).max(1000) })]);

/** Resolve a candidate's deletion request (admins): delete now, or decline with a reason (e.g. legal hold). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  const b = Body.parse(await req.json());
  if (b.action === "delete") await fulfilDeletion(id, { type: "staff", id: user.id, orgId: user.orgId });
  else await declineDeletion(id, b.reason, user);
  return json({ ok: true });
});
