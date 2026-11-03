import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { addReference } from "@/lib/services/similarity";

const Body = z.object({ problemId: z.string().min(1).max(80), language: z.string().max(20), source: z.string().trim().min(2).max(300), code: z.string().min(20).max(50_000) });

/** A known published solution (e.g. found online): past and future submissions are compared with it. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  return json(await addReference(user, Body.parse(await req.json())), 201);
});
