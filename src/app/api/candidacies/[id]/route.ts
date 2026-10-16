import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { purgeCandidacy } from "@/lib/services/maintenance";

/** Data-subject deletion: permanently delete a candidate's data for this drive. */
export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  const { id } = await params;
  await purgeCandidacy(id, "admin_request", { type: "staff", id: user.id });
  return json({ ok: true });
});
