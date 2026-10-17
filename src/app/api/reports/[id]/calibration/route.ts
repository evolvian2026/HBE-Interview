import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { requestCalibration } from "@/lib/services/calibration";

/** Ask for a blind human review of this round (it joins the calibration queue). */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("hiring_manager");
  const { id } = await params;
  await requestCalibration(user, id);
  return json({ ok: true });
});
