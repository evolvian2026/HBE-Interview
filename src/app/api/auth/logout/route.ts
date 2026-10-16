import { clearStaffSession } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";

export const POST = handle(async () => {
  await clearStaffSession();
  return json({ ok: true });
});
