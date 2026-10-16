import { z } from "zod";
import { handle, json } from "@/lib/http";
import { registerOpen } from "@/lib/services/candidacy";

const Body = z.object({ slug: z.string().min(4).max(40), name: z.string().trim().min(1).max(120), email: z.string().trim().email() });

export const POST = handle(async (req: Request) => {
  const { slug, name, email } = Body.parse(await req.json());
  const c = await registerOpen(slug, name, email);
  return json({ token: c.accessToken });
});
