/** Create the first admin (from ADMIN_EMAIL/ADMIN_PASSWORD) and a sample HR policy document. Safe to re-run. */
import "./load-env";
import { eq } from "drizzle-orm";
import { db, pool, schema } from "../src/lib/db";
import { ensureBootstrapAdmin } from "../src/lib/auth/staff";
import { DEFAULT_ORG_ID } from "../src/lib/tenancy";

await ensureBootstrapAdmin();
const docs = await db.select({ id: schema.kbDocuments.id }).from(schema.kbDocuments).where(eq(schema.kbDocuments.orgId, DEFAULT_ORG_ID)).limit(1);
if (!docs.length) {
  await db.insert(schema.kbDocuments).values({
    orgId: DEFAULT_ORG_ID,
    title: "Sample: Leave & Work Policy (edit me)",
    content:
      "Annual leave: 18 days per year, accrued monthly.\nSick leave: 10 days per year.\nWork model: hybrid, 3 days per week in office.\nProbation: 6 months.\nNotice period after confirmation: 60 days.\n(Replace this sample with your real policies in Settings → HR knowledge base.)",
  });
}
console.log("Seed complete");
await pool.end();
