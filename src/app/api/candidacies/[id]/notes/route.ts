import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";

const Body = z.object({ text: z.string().trim().min(1).max(4000) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  await db.insert(schema.candidacyNotes).values({ candidacyId: id, userId: user.id, text: Body.parse(await req.json()).text });
  return json({ ok: true });
});
