import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { scanPast } from "@/lib/services/similarity";

/** Check rounds that ended before copied-code detection was turned on. */
export const POST = handle(async () => {
  const user = await requireStaff("admin");
  await limit(`code-scan:${user.orgId}`, 10, 3600);
  return json(await scanPast(user));
});
