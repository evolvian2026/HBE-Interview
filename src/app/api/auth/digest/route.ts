import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";

const Body = z.object({ optIn: z.boolean() });

/** Turn the daily inbox email on or off for yourself. */
export const PUT = handle(async (req: Request) => {
  const user = await requireStaff("viewer");
  const { optIn } = Body.parse(await req.json());
  await db.update(schema.users).set({ digestOptIn: optIn }).where(eq(schema.users.id, user.id));
  return json({ optIn });
});
