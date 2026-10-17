import { z } from "zod";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { unlockShareLink } from "@/lib/services/share";
import { clientIp, limit, resetLimit } from "@/lib/security/rate-limit";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const key = `share:${token.slice(0, 64)}`;
  await limit(key, 5, 15 * 60, "Too many attempts — try again in 15 minutes");
  await limit(`share-ip:${clientIp(req)}`, 30, 15 * 60, "Too many attempts — try again in 15 minutes");
  const { passcode } = z.object({ passcode: z.string().min(1).max(64) }).parse(await req.json());
  if (!(await unlockShareLink(token, passcode))) throw new HttpError(401, "Incorrect passcode");
  await resetLimit(key);
  return json({ ok: true });
});
