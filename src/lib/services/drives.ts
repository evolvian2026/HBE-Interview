import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { db, schema } from "../db";
import { analyzeJd } from "../ai/analyzers";
import { buildDefaultDriveConfig, validateDriveConfig } from "../core/rounds";
import { DriveConfigSchema } from "../core/config-schema";
import type { DriveConfig } from "../core/types";
import { HttpError, requireDriveAccess, type StaffUser } from "../auth/staff";
import { audit } from "../audit";

const slug = customAlphabet("abcdefghijkmnopqrstuvwxyz23456789", 10);

export async function createDrive(title: string, jdText: string, user: StaffUser) {
  if (jdText.trim().length < 200) throw new HttpError(400, "Add more detail to the JD (responsibilities, skills, experience) — at least 200 characters.");
  const profile = await analyzeJd(title, jdText, { orgId: user.orgId });
  const config = buildDefaultDriveConfig(title, jdText, profile);
  const [d] = await db.insert(schema.drives).values({ orgId: user.orgId, title, draft: config, openSlug: slug(), createdBy: user.id }).returning();
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "drive.create", "drive", d.id);
  return d;
}

export async function reanalyzeDrive(driveId: string, user: StaffUser) {
  const d = await requireDriveAccess(user, driveId);
  const draft = d.draft as DriveConfig;
  const profile = await analyzeJd(draft.title, draft.jdText, { orgId: user.orgId });
  const config = buildDefaultDriveConfig(draft.title, draft.jdText, profile);
  await db.update(schema.drives).set({ draft: config, updatedAt: new Date() }).where(eq(schema.drives.id, driveId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "drive.reanalyze", "drive", driveId);
  return config;
}

export async function saveDraft(driveId: string, input: unknown, user: StaffUser) {
  await requireDriveAccess(user, driveId);
  const config = DriveConfigSchema.parse(input) as DriveConfig;
  await db.update(schema.drives).set({ draft: config, title: config.title, updatedAt: new Date() }).where(and(eq(schema.drives.id, driveId), eq(schema.drives.orgId, user.orgId)));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "drive.save", "drive", driveId);
  return { config, issues: validateDriveConfig(config) };
}

export async function publishDrive(driveId: string, user: StaffUser) {
  const d = await requireDriveAccess(user, driveId);
  const config = d.draft as DriveConfig;
  const issues = validateDriveConfig(config);
  if (issues.length) throw new HttpError(400, issues.map((i) => i.message).join("; "));
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${schema.driveVersions.version}), 0)` })
    .from(schema.driveVersions)
    .where(eq(schema.driveVersions.driveId, driveId));
  const [v] = await db.insert(schema.driveVersions).values({ driveId, version: Number(max) + 1, config }).returning();
  await db.update(schema.drives).set({ currentVersionId: v.id, status: "active", updatedAt: new Date() }).where(eq(schema.drives.id, driveId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, "drive.publish", "drive", driveId, { version: v.version });
  return v;
}

export async function setDriveStatus(driveId: string, status: "active" | "paused" | "closed", user: StaffUser) {
  const d = await requireDriveAccess(user, driveId);
  if (status === "active" && !d.currentVersionId) throw new HttpError(400, "Publish the drive first");
  await db.update(schema.drives).set({ status, updatedAt: new Date() }).where(eq(schema.drives.id, driveId));
  await audit({ type: "staff", id: user.id, orgId: user.orgId }, `drive.${status}`, "drive", driveId);
}

/** Drives of the session's organisation (hiring managers: only assigned drives). */
export async function listDrives(user: StaffUser) {
  const drives = (await db.select().from(schema.drives).where(eq(schema.drives.orgId, user.orgId)).orderBy(desc(schema.drives.updatedAt))).filter(
    (d) => user.role !== "hiring_manager" || (user.driveIds ?? []).includes(d.id),
  );
  const ids = drives.map((d) => d.id);
  const counts = ids.length
    ? await db
        .select({ driveId: schema.candidacies.driveId, stage: schema.candidacies.stage, n: sql<number>`count(*)::int` })
        .from(schema.candidacies)
        .where(inArray(schema.candidacies.driveId, ids))
        .groupBy(schema.candidacies.driveId, schema.candidacies.stage)
    : [];
  return drives.map((d) => {
    const byStage: Record<string, number> = {};
    for (const c of counts.filter((x) => x.driveId === d.id)) byStage[c.stage] = c.n;
    return { ...d, byStage, total: Object.values(byStage).reduce((a, b) => a + b, 0) };
  });
}
