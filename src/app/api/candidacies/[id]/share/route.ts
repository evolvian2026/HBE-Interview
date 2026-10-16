import { z } from "zod";
import { assertCandidacyAccess, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { createShareLink } from "@/lib/services/share";

const Body = z.object({ days: z.number().int().min(1).max(30), passcode: z.string().min(4).max(64).optional(), masked: z.boolean() });

/** Create an expiring read-only share link for this candidate's report. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  await assertCandidacyAccess(user, id);
  const b = Body.parse(await req.json());
  const { url, link } = await createShareLink(id, user.id, b);
  return json({ url, id: link.id, expiresAt: link.expiresAt });
});
