import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isUuid } from "@/lib/auth/staff";

/** An organisation's logo for candidate pages (public; PNG/JPEG only; long-cached by content-hash URL). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const [o] = await db.select({ logo: schema.organizations.logo, mime: schema.organizations.logoMime }).from(schema.organizations).where(eq(schema.organizations.id, id));
  if (!o?.logo || !o.mime || !["image/png", "image/jpeg"].includes(o.mime)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(o.logo), {
    headers: {
      "content-type": o.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
