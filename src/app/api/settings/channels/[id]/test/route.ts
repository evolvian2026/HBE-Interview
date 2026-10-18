import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { testChannel } from "@/lib/services/channels";

/** Send a test message to the channel right away. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  await limit(`channel-test:${user.id}`, 20, 60 * 60);
  return json(await testChannel(user, (await params).id));
});
