/**
 * SCIM 2.0 (RFC 7643/7644) for staff provisioning (pure): filters, PATCH operations, resource shapes, errors.
 * Lenient where identity providers differ (Entra sends "False" as a string and capitalised ops; Okta sends paths).
 */

export const SCHEMA = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  list: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
} as const;

export type ScimRole = "admin" | "recruiter" | "hiring_manager" | "viewer";

/** Fixed groups mapping to roles; membership in one sets the user's role. */
export const ROLE_GROUPS: { id: ScimRole; displayName: string }[] = [
  { id: "admin", displayName: "HBE Admins" },
  { id: "recruiter", displayName: "HBE Recruiters" },
  { id: "hiring_manager", displayName: "HBE Hiring Managers" },
  { id: "viewer", displayName: "HBE Viewers" },
];

export class ScimError extends Error {
  constructor(
    public status: number,
    message: string,
    public scimType?: string,
  ) {
    super(message);
  }
}

export const scimError = (status: number, detail: string, scimType?: string) => ({ schemas: [SCHEMA.error], status: String(status), detail, ...(scimType ? { scimType } : {}) });

/** `attr eq "value"` — the only filter identity providers use for provisioning. */
export function parseFilter(filter: string | null): { attr: string; value: string } | null {
  if (!filter?.trim()) return null;
  const m = filter.trim().match(/^([A-Za-z.]+(?:\[[^\]]*\])?(?:\.[A-Za-z]+)?)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  if (!m) throw new ScimError(400, `Unsupported filter: ${filter}`, "invalidFilter");
  const attr = m[1].toLowerCase().replace(/\[type eq "work"\]/i, "");
  const known = ["username", "externalid", "emails.value", "emails", "displayname", "id"];
  if (!known.includes(attr)) throw new ScimError(400, `Filtering on ${m[1]} isn't supported`, "invalidFilter");
  return { attr: attr === "emails" ? "emails.value" : attr, value: m[2].replace(/\\(.)/g, "$1") };
}

export interface ScimUserState {
  userName: string;
  givenName: string;
  familyName: string;
  displayName: string;
  active: boolean;
  externalId: string | null;
}

const bool = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() === "true" : !!v);
const str = (v: unknown) => (v == null ? "" : String(v)).trim();

function primaryEmail(v: unknown): string | null {
  if (!Array.isArray(v)) return typeof v === "string" ? v : null;
  const list = v as { value?: string; primary?: boolean | string; type?: string }[];
  return (list.find((e) => bool(e.primary)) ?? list.find((e) => e.type === "work") ?? list[0])?.value ?? null;
}

/** Fold a SCIM User body (POST/PUT) into our fields. */
export function userFromBody(body: Record<string, unknown>, current?: ScimUserState): ScimUserState {
  const name = (body.name ?? {}) as Record<string, unknown>;
  const email = str(body.userName) || primaryEmail(body.emails) || current?.userName || "";
  const given = str(name.givenName) || current?.givenName || "";
  const family = str(name.familyName) || current?.familyName || "";
  const display = str(body.displayName) || str(name.formatted) || [given, family].filter(Boolean).join(" ") || current?.displayName || email.split("@")[0];
  return { userName: email.toLowerCase(), givenName: given, familyName: family, displayName: display, active: body.active == null ? (current?.active ?? true) : bool(body.active), externalId: body.externalId == null ? (current?.externalId ?? null) : str(body.externalId) || null };
}

interface PatchOp {
  op: string;
  path?: string;
  value?: unknown;
}

function opsOf(body: Record<string, unknown>): PatchOp[] {
  const ops = body.Operations ?? body.operations;
  if (!Array.isArray(ops) || !ops.length) throw new ScimError(400, "PATCH needs Operations", "invalidSyntax");
  return ops as PatchOp[];
}

/** Apply a SCIM PATCH to a user. Unknown attributes are ignored rather than failing the whole request. */
export function applyUserPatch(current: ScimUserState, body: Record<string, unknown>): ScimUserState {
  let s = { ...current };
  for (const raw of opsOf(body)) {
    const op = str(raw.op).toLowerCase();
    if (!["add", "replace", "remove"].includes(op)) throw new ScimError(400, `Unsupported op: ${raw.op}`, "invalidSyntax");
    const path = str(raw.path).toLowerCase();
    if (!path) {
      if (op === "remove") throw new ScimError(400, "remove needs a path", "noTarget");
      const v = (raw.value ?? {}) as Record<string, unknown>;
      // Entra sometimes sends dotted keys inside the value object.
      const flat: Record<string, unknown> = { ...v };
      for (const [k, val] of Object.entries(v)) if (k.includes(".")) flat[k.toLowerCase()] = val;
      s = applyPath(s, flat);
      continue;
    }
    s = applyPath(s, { [path]: op === "remove" ? null : raw.value });
  }
  return s;
}

function applyPath(s: ScimUserState, values: Record<string, unknown>): ScimUserState {
  const out = { ...s };
  for (const [kRaw, v] of Object.entries(values)) {
    const k = kRaw.toLowerCase().replace(/\[type eq "work"\]/, "");
    if (k === "active") out.active = bool(v);
    else if (k === "username") out.userName = str(v).toLowerCase() || out.userName;
    else if (k === "displayname") out.displayName = str(v) || out.displayName;
    else if (k === "externalid") out.externalId = str(v) || null;
    else if (k === "name.givenname") out.givenName = str(v);
    else if (k === "name.familyname") out.familyName = str(v);
    else if (k === "name.formatted") out.displayName = str(v) || out.displayName;
    else if (k === "name" && v && typeof v === "object") {
      const n = v as Record<string, unknown>;
      if (n.givenName != null) out.givenName = str(n.givenName);
      if (n.familyName != null) out.familyName = str(n.familyName);
      if (n.formatted) out.displayName = str(n.formatted);
    } else if (k === "emails" || k === "emails.value") {
      const e = k === "emails" ? primaryEmail(v) : str(v);
      if (e) out.userName = e.toLowerCase();
    }
  }
  return out;
}

/** Member changes in a Group PATCH: which user ids to add and remove (replace = set exactly). */
export function groupPatch(body: Record<string, unknown>): { add: string[]; remove: string[]; replace: string[] | null } {
  const add: string[] = [];
  const remove: string[] = [];
  let replace: string[] | null = null;
  for (const raw of opsOf(body)) {
    const op = str(raw.op).toLowerCase();
    const path = str(raw.path);
    const vals = (Array.isArray(raw.value) ? raw.value : raw.value && typeof raw.value === "object" && "members" in (raw.value as object) ? (raw.value as { members: unknown[] }).members : []) as { value?: string }[];
    const ids = vals.map((m) => str(m.value)).filter(Boolean);
    const filtered = path.match(/^members\[value eq "([^"]+)"\]$/i);
    if (op === "add") add.push(...ids);
    else if (op === "remove") {
      if (filtered) remove.push(filtered[1]);
      else if (/^members$/i.test(path)) remove.push(...ids);
      else if (!path) remove.push(...ids);
    } else if (op === "replace") {
      if (/^members$/i.test(path) || !path) replace = ids;
    } else throw new ScimError(400, `Unsupported op: ${raw.op}`, "invalidSyntax");
  }
  return { add, remove, replace };
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  scimExternalId: string | null;
  createdAt: Date;
}

export function toScimUser(u: UserRow, base: string) {
  const [given, ...rest] = u.name.split(/\s+/);
  const group = ROLE_GROUPS.find((g) => g.id === u.role);
  return {
    schemas: [SCHEMA.user],
    id: u.id,
    userName: u.email,
    ...(u.scimExternalId ? { externalId: u.scimExternalId } : {}),
    name: { formatted: u.name, givenName: given ?? "", familyName: rest.join(" ") },
    displayName: u.name,
    emails: [{ value: u.email, type: "work", primary: true }],
    active: u.active,
    groups: group ? [{ value: group.id, display: group.displayName, $ref: `${base}/Groups/${group.id}` }] : [],
    meta: { resourceType: "User", created: u.createdAt.toISOString(), location: `${base}/Users/${u.id}` },
  };
}

export function toScimGroup(g: { id: ScimRole; displayName: string }, members: { id: string; name: string }[], base: string) {
  return {
    schemas: [SCHEMA.group],
    id: g.id,
    displayName: g.displayName,
    members: members.map((m) => ({ value: m.id, display: m.name, $ref: `${base}/Users/${m.id}` })),
    meta: { resourceType: "Group", location: `${base}/Groups/${g.id}` },
  };
}

export function listResponse<T>(resources: T[], total: number, startIndex: number) {
  return { schemas: [SCHEMA.list], totalResults: total, startIndex, itemsPerPage: resources.length, Resources: resources };
}

/** SCIM paging: startIndex is 1-based; count is capped. */
export function paging(params: URLSearchParams) {
  const startIndex = Math.max(1, Number.parseInt(params.get("startIndex") ?? "1", 10) || 1);
  const n = Number.parseInt(params.get("count") ?? "", 10);
  const count = Number.isNaN(n) ? 100 : Math.min(200, Math.max(0, n));
  return { startIndex, count };
}
