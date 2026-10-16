import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { createDrive } from "@/lib/services/drives";

const Body = z.object({ title: z.string().trim().min(2).max(200), jdText: z.string().trim().min(1).max(20000) });

export const POST = handle(async (req: Request) => {
  const user = await requireStaff("recruiter");
  const { title, jdText } = Body.parse(await req.json());
  const drive = await createDrive(title, jdText, user);
  return json({ id: drive.id });
});
