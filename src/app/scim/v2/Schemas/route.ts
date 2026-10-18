import { SCHEMA, listResponse } from "@/lib/core/scim";
import { scim, scimJson } from "@/lib/scim/http";

const attr = (name: string, type = "string", extra: Record<string, unknown> = {}) => ({ name, type, multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none", ...extra });

export const GET = scim(async () =>
  scimJson(
    listResponse(
      [
        {
          id: SCHEMA.user,
          name: "User",
          attributes: [
            attr("userName", "string", { required: true, uniqueness: "server" }),
            attr("name", "complex", { subAttributes: [attr("givenName"), attr("familyName"), attr("formatted")] }),
            attr("displayName"),
            attr("emails", "complex", { multiValued: true, subAttributes: [attr("value"), attr("type"), attr("primary", "boolean")] }),
            attr("active", "boolean"),
            attr("externalId"),
            attr("groups", "complex", { multiValued: true, mutability: "readOnly" }),
          ],
        },
        { id: SCHEMA.group, name: "Group", attributes: [attr("displayName", "string", { mutability: "readOnly" }), attr("members", "complex", { multiValued: true })] },
      ],
      2,
      1,
    ),
  ),
);
