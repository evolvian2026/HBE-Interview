import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { audit } from "@/lib/audit";

const MAX = 200 * 1024;

/** Detect PNG/JPEG by content, never by the file name or declared type (SVG is refused: it can carry scripts). */
function sniff(b: Buffer): "image/png" | "image/jpeg" | null {
  if (b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString() === "PNG") return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose an image");
  if (file.size > MAX) throw new HttpError(400, "Logo must be 200 KB or smaller");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) throw new HttpError(400, "Upload a PNG or JPEG image");
  await db.update(schema.organizations).set({ logo: bytes, logoMime: mime }).where(eq(schema.organizations.id, user.orgId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.branding_logo", "organization", user.orgId, { bytes: bytes.length, mime });
  return json({ ok: true }, 201);
});

export const DELETE = handle(async () => {
  const user = await requireStaff("admin");
  await db.update(schema.organizations).set({ logo: null, logoMime: null }).where(eq(schema.organizations.id, user.orgId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "settings.branding_logo_removed", "organization", user.orgId);
  return json({ ok: true });
});
