import { scim, scimJson } from "@/lib/scim/http";

export const GET = scim(async () =>
  scimJson({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://github.com/evolvian2026/hbe-interview/blob/main/docs/FEATURES.md",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "The token from Settings → User provisioning", primary: true }],
  }),
);
