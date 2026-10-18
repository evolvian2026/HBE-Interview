import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { DEFAULT_CALIBRATION, type CalibrationSettings } from "./core/calibration";
import type { TemplateKey, TemplateText } from "./core/templates";

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
  /** Staff must use two-factor sign-in (TOTP). */
  require2fa: boolean;
  /** Blind human reviews of AI-evaluated rounds (human oversight of the AI's scoring). */
  calibration: CalibrationSettings;
  /** Customised candidate emails; a missing key uses the built-in default. */
  emailTemplates: Partial<Record<TemplateKey, TemplateText>>;
}

/** Platform-wide settings, managed by platform admins (models are a cost/quality decision for the operator). */
export interface PlatformSettings {
  /** Per-tier model overrides (empty = use environment defaults). */
  models: { interviewer: string; analyzer: string; evaluator: string; utility: string };
  interviewerEffort: "" | "low" | "medium" | "high";
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
  require2fa: false,
  calibration: DEFAULT_CALIBRATION,
  emailTemplates: {},
};

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  models: { interviewer: "", analyzer: "", evaluator: "", utility: "" },
  interviewerEffort: "",
};

export { MODEL_CHOICES } from "./settings-shared";

const orgKey = (orgId: string) => `org:${orgId}`;

async function readKey<T>(key: string, defaults: T): Promise<T> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return { ...defaults, ...((row?.value as Partial<T>) ?? {}) };
}

async function writeKey(key: string, value: object) {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

/** An organisation's settings (company profile, values, consent, retention…). */
export async function getSettings(orgId: string): Promise<OrgSettings> {
  return readKey(orgKey(orgId), DEFAULT_SETTINGS);
}

export async function saveSettings(orgId: string, patch: Partial<OrgSettings>) {
  const current = await getSettings(orgId);
  const next = { ...current, ...patch };
  if (patch.consentText && patch.consentText !== current.consentText) next.consentVersion = current.consentVersion + 1;
  await writeKey(orgKey(orgId), next);
  return next;
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  return readKey("platform", DEFAULT_PLATFORM_SETTINGS);
}

export async function savePlatformSettings(patch: Partial<PlatformSettings>) {
  const next = { ...(await getPlatformSettings()), ...patch };
  await writeKey("platform", next);
  return next;
}
