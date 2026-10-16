import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export interface OrgValue {
  name: string;
  description: string;
  behaviors: string[];
}

export interface OrgSettings {
  companyName: string;
  companyBlurb: string;
  supportEmail: string;
  values: OrgValue[];
  /** HR round asks expected compensation (off by default — product decision). */
  askCompensation: boolean;
  retentionDays: number;
  consentText: string;
  consentVersion: number;
}

export const DEFAULT_VALUES: OrgValue[] = [
  { name: "Ownership", description: "Takes responsibility for outcomes end to end.", behaviors: ["Follows through without being chased", "Owns mistakes and fixes them"] },
  { name: "Collaboration", description: "Works effectively with others toward shared goals.", behaviors: ["Shares context proactively", "Helps teammates succeed"] },
  { name: "Integrity", description: "Is honest and does the right thing.", behaviors: ["Raises concerns openly", "Keeps commitments"] },
  { name: "Learning", description: "Continuously learns and improves.", behaviors: ["Seeks feedback", "Applies lessons from failure"] },
  { name: "Customer Focus", description: "Starts from the customer's needs.", behaviors: ["Seeks customer feedback", "Escalates customer-impacting issues"] },
];

export const DEFAULT_CONSENT = `This interview is conducted and evaluated by an AI interviewer. We record your interview transcript, any code or written responses you produce, and browser activity signals (such as tab switches and paste events) for the purpose of assessing your application. The AI's evaluation is advisory: a member of our hiring team reviews every report and makes the decision. Your data is retained for the configured retention period and then deleted. You may request access to or deletion of your data by contacting us.`;

export const DEFAULT_SETTINGS: OrgSettings = {
  companyName: "HBE",
  companyBlurb: "",
  supportEmail: "",
  values: DEFAULT_VALUES,
  askCompensation: false,
  retentionDays: 180,
  consentText: DEFAULT_CONSENT,
  consentVersion: 1,
};

export async function getSettings(): Promise<OrgSettings> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "org"));
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<OrgSettings>) ?? {}) };
}

export async function saveSettings(patch: Partial<OrgSettings>) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  if (patch.consentText && patch.consentText !== current.consentText) next.consentVersion = current.consentVersion + 1;
  await db
    .insert(schema.settings)
    .values({ key: "org", value: next })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}
