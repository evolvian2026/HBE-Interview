import { describe, expect, it } from "vitest";
import { applyUserPatch, groupPatch, paging, parseFilter, ScimError, toScimUser, userFromBody, type ScimUserState } from "@/lib/core/scim";

const base: ScimUserState = { userName: "priya@acme.com", givenName: "Priya", familyName: "Sharma", displayName: "Priya Sharma", active: true, externalId: "00u1" };

describe("SCIM filters", () => {
  it("parses the eq filters identity providers send", () => {
    expect(parseFilter('userName eq "Priya@Acme.com"')).toEqual({ attr: "username", value: "Priya@Acme.com" });
    expect(parseFilter('emails[type eq "work"].value eq "a@b.c"')).toEqual({ attr: "emails.value", value: "a@b.c" });
    expect(parseFilter('externalId eq "abc"')).toEqual({ attr: "externalid", value: "abc" });
    expect(parseFilter('displayName eq "HBE Recruiters"')).toEqual({ attr: "displayname", value: "HBE Recruiters" });
    expect(parseFilter(null)).toBeNull();
  });
  it("rejects anything else with invalidFilter", () => {
    expect(() => parseFilter('userName co "a"')).toThrow(ScimError);
    expect(() => parseFilter('password eq "x"')).toThrow(/isn't supported/);
  });
});

describe("SCIM users", () => {
  it("builds a user from a POST body (Okta / Entra shapes)", () => {
    expect(userFromBody({ userName: "Omar@Acme.com", name: { givenName: "Omar", familyName: "Ali" }, active: true })).toMatchObject({ userName: "omar@acme.com", displayName: "Omar Ali", active: true });
    expect(userFromBody({ emails: [{ value: "x@acme.com", primary: "true" }], displayName: "X Y", active: "False", externalId: "e1" })).toMatchObject({ userName: "x@acme.com", displayName: "X Y", active: false, externalId: "e1" });
  });
  it("applies Okta path ops and Entra value-object ops", () => {
    expect(applyUserPatch(base, { Operations: [{ op: "replace", path: "active", value: false }] }).active).toBe(false);
    expect(applyUserPatch(base, { Operations: [{ op: "Replace", path: "active", value: "False" }] }).active).toBe(false);
    const e = applyUserPatch(base, { Operations: [{ op: "Replace", value: { "name.givenName": "Pri", displayName: "Pri Sharma", active: true } }] });
    expect(e).toMatchObject({ givenName: "Pri", displayName: "Pri Sharma", active: true });
    expect(applyUserPatch(base, { Operations: [{ op: "replace", path: 'emails[type eq "work"].value', value: "New@Acme.com" }] }).userName).toBe("new@acme.com");
    expect(applyUserPatch(base, { Operations: [{ op: "remove", path: "externalId" }] }).externalId).toBeNull();
    expect(applyUserPatch(base, { Operations: [{ op: "add", path: "urn:custom:thing", value: 1 }] })).toEqual(base); // unknown → ignored
  });
  it("rejects malformed patches", () => {
    expect(() => applyUserPatch(base, {})).toThrow(/Operations/);
    expect(() => applyUserPatch(base, { Operations: [{ op: "move", path: "active" }] })).toThrow(/Unsupported op/);
    expect(() => applyUserPatch(base, { Operations: [{ op: "remove" }] })).toThrow(/path/);
  });
  it("shapes a user resource", () => {
    const r = toScimUser({ id: "u1", email: "priya@acme.com", name: "Priya Sharma", role: "recruiter", active: true, scimExternalId: "00u1", createdAt: new Date("2026-10-01T00:00:00Z") }, "https://app/scim/v2");
    expect(r).toMatchObject({ id: "u1", userName: "priya@acme.com", externalId: "00u1", active: true, name: { givenName: "Priya", familyName: "Sharma" }, groups: [{ value: "recruiter", display: "HBE Recruiters" }], meta: { location: "https://app/scim/v2/Users/u1" } });
  });
});

describe("SCIM groups and paging", () => {
  it("reads member changes in the shapes Okta and Entra use", () => {
    expect(groupPatch({ Operations: [{ op: "add", path: "members", value: [{ value: "u1" }, { value: "u2" }] }] })).toEqual({ add: ["u1", "u2"], remove: [], replace: null });
    expect(groupPatch({ Operations: [{ op: "remove", path: 'members[value eq "u3"]' }] }).remove).toEqual(["u3"]);
    expect(groupPatch({ Operations: [{ op: "Remove", path: "members", value: [{ value: "u4" }] }] }).remove).toEqual(["u4"]);
    expect(groupPatch({ Operations: [{ op: "replace", path: "members", value: [{ value: "u5" }] }] }).replace).toEqual(["u5"]);
    expect(groupPatch({ Operations: [{ op: "add", value: { members: [{ value: "u6" }] } }] }).add).toEqual(["u6"]);
  });
  it("pages 1-based and caps the page size", () => {
    expect(paging(new URLSearchParams("startIndex=0&count=1000"))).toEqual({ startIndex: 1, count: 200 });
    expect(paging(new URLSearchParams(""))).toEqual({ startIndex: 1, count: 100 });
    expect(paging(new URLSearchParams("count=0"))).toEqual({ startIndex: 1, count: 0 }); // "just the total"
  });
});
