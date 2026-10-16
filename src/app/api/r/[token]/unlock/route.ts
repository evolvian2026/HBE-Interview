import { z } from "zod";
import { HttpError } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { unlockShareLink } from "@/lib/services/share";

const attempts = new Map<string, { n: number; at: number }>();

export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const a = attempts.get(token);
  if (a && a.n >= 5 && Date.now() - a.at < 15 * 60_000) throw new HttpError(429, "Too many attempts — try again in 15 minutes");
  const { passcode } = z.object({ passcode: z.string().min(1).max(64) }).parse(await req.json());
  if (!(await unlockShareLink(token, passcode))) {
    attempts.set(token, { n: (a?.n ?? 0) + 1, at: Date.now() });
    throw new HttpError(401, "Incorrect passcode");
  }
  attempts.delete(token);
  return json({ ok: true });
});
