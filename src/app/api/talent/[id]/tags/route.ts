import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { setTags } from "@/lib/services/talent";

const Body = z.object({ tags: z.array(z.string().max(60)).max(30) });

export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("recruiter");
  const { id } = await params;
  return json({ tags: await setTags(user, id, Body.parse(await req.json()).tags) });
});
