import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { ensureKbIndexed, searchKb } from "@/lib/services/kb";

/** Preview which knowledge-base passages the HR interviewer would receive for a candidate question. */
export const GET = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 500);
  await ensureKbIndexed(user.orgId);
  const hits = await searchKb(user.orgId, q);
  return json({ passages: hits.map((h) => ({ title: h.title, content: h.content, rank: Math.round(h.rank * 1000) / 1000 })) });
});
