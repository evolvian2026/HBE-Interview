import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { enqueue } from "@/lib/jobs/queue";

/** Generate (or regenerate) the combined report, including partial results. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireStaff("hiring_manager");
  const { id } = await params;
  await enqueue("combined-report", { candidacyId: id }, { singletonKey: `combined:${id}` });
  return json({ ok: true });
});
