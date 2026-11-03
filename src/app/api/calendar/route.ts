import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { disconnect } from "@/lib/services/calendar";

/** Disconnect the signed-in person's calendar. Events already created stay in their calendar. */
export const DELETE = handle(async () => {
  const user = await requireStaff("hiring_manager");
  await disconnect(user);
  return json({ ok: true });
});
