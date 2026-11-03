import { requireStaff } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { runCsv } from "@/lib/services/benchmark";

/** Expected and AI scores per case and parameter (no names: case titles are role · drive · id). */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireStaff("admin");
  const { csv, name } = await runCsv(user, (await params).id);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
});
