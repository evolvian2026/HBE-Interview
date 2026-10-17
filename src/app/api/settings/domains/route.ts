import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { addDomain } from "@/lib/services/sso";
import { verificationRecord } from "@/lib/core/domain";

/** Claim an email domain for single sign-on; returns the DNS TXT record that proves ownership. */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  const { domain } = z.object({ domain: z.string().min(3).max(253) }).parse(await req.json());
  const d = await addDomain(user.orgId, domain, user);
  return json({ id: d.id, domain: d.domain, txt: verificationRecord(d.verificationToken) }, 201);
});
