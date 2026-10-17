import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";
import { brandColorProblem } from "@/lib/core/brand";

/** Set or clear the candidate-facing brand colour (must keep white text readable: ≥ 4.5:1). */
export const PUT = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const { brandColor } = z.object({ brandColor: z.string().trim().max(7).nullable() }).parse(await req.json());
  const color = brandColor ? brandColor.toLowerCase() : null;
  if (color) {
    const problem = brandColorProblem(color);
    if (problem) throw new HttpError(400, problem);
  }
  await db.update(schema.organizations).set({ brandColor: color }).where(eq(schema.organizations.id, user.orgId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.branding", "organization", user.orgId, { brandColor: color });
  return json({ ok: true });
});
