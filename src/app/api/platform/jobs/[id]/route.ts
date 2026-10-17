import { z } from "zod";
import { HttpError, requirePlatformAdmin, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { discardJob, retryJob } from "@/lib/services/ops";

const Body = z.object({ action: z.enum(["retry", "discard"]) });

/** Retry or discard a failed background job (platform admins). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("viewer");
  requirePlatformAdmin(user);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, "Job not found");
  const { action } = Body.parse(await req.json());
  if (action === "retry") await retryJob(id);
  else await discardJob(id);
  await audit({ type: "staff", id: user.id, orgId: user.homeOrgId }, `org.job_${action}`, "job", String(id));
  return json({ ok: true });
});
