import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const userRoleTools: Tool[] = [
  {
    name: "tv_user_roles",
    description: `Manage company user roles and the predefined default role.

action values:
  list               — list all roles (no params)
  get_permissions    — list available permission definitions (no params)
  create             — create a role (required: name, permissions[])
  update             — update a role (required: user_role_id, name, permissions[])
  delete             — delete a role (required: user_role_id)
  get_predefined     — get the predefined default role (no params)
  set_predefined     — set the predefined role (required: user_role_id)
  clear_predefined   — clear the predefined role (no params)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get_permissions", "create", "update", "delete", "get_predefined", "set_predefined", "clear_predefined"] },
        user_role_id: { type: "string", description: "User role ID" },
        name: { type: "string", description: "Role name" },
        permissions: { type: "array", items: { type: "string" }, description: "Permission strings" },
      },
    },
  },
  {
    name: "tv_user_role_assignments",
    description: `Assign and unassign user roles to accounts and user groups, and query assignments.

action values:
  assign_to_accounts       — assign a role to accounts (required: user_role_id, user_ids[])
  assign_to_group          — assign a role to a user group (required: user_role_id, user_group_id)
  unassign_from_accounts   — unassign a role from accounts (required: user_role_id, user_ids[])
  unassign_from_group      — unassign a role from a user group (required: user_role_id, user_group_id)
  get_account_assignments  — get accounts assigned to a role (required: user_role_id; optional: continuation_token)
  get_group_assignments    — get user groups assigned to a role (required: user_role_id; optional: continuation_token)`,
    inputSchema: {
      type: "object",
      required: ["action", "user_role_id"],
      properties: {
        action: { type: "string", enum: ["assign_to_accounts", "assign_to_group", "unassign_from_accounts", "unassign_from_group", "get_account_assignments", "get_group_assignments"] },
        user_role_id: { type: "string", description: "User role ID" },
        user_ids: { type: "array", items: { type: "string" }, description: "Account IDs" },
        user_group_id: { type: "number", description: "User group ID" },
        continuation_token: { type: "string", description: "Pagination token" },
      },
    },
  },
  {
    name: "tv_user_groups",
    description: `Manage user groups.

action values:
  list      — list all user groups (optional: pagination_token, limit)
  get       — get a user group (required: group_id)
  create    — create a user group (required: name)
  update    — update a user group name (required: group_id, name)
  delete    — delete a user group (required: group_id)
  get_role  — get the role assigned to a user group (required: group_id)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "get_role"] },
        group_id: { type: "string", description: "User group ID" },
        name: { type: "string", description: "User group display name" },
        pagination_token: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "tv_user_group_members",
    description: `Manage members of a user group.

action values:
  list        — list members (required: group_id; optional: pagination_token, limit)
  add         — add members (required: group_id, account_ids[])
  remove      — remove multiple members (required: group_id, account_ids[])
  remove_one  — remove a single member (required: group_id, account_id)`,
    inputSchema: {
      type: "object",
      required: ["action", "group_id"],
      properties: {
        action: { type: "string", enum: ["list", "add", "remove", "remove_one"] },
        group_id: { type: "string", description: "User group ID" },
        account_id: { type: "string", description: "Single account ID (remove_one)" },
        account_ids: { type: "array", items: { type: "string" }, description: "Account IDs (add, remove)" },
        pagination_token: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
];

export async function handleUserRoleTool(
  name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action } = args as { action: string };

  if (name === "tv_user_role_assignments") {
    const { user_role_id, user_ids, user_group_id, continuation_token } = args as {
      user_role_id: string; user_ids?: string[]; user_group_id?: number; continuation_token?: string;
    };
    switch (action) {
      case "assign_to_accounts":      return client.post("/userroles/assign/account", { UserRoleId: user_role_id, UserIds: user_ids });
      case "assign_to_group":         return client.post("/userroles/assign/usergroup", { UserRoleId: user_role_id, UserGroupId: user_group_id });
      case "unassign_from_accounts":  return client.post("/userroles/unassign/account", { UserRoleId: user_role_id, UserIds: user_ids });
      case "unassign_from_group":     return client.post("/userroles/unassign/usergroup", { UserRoleId: user_role_id, UserGroupId: user_group_id });
      case "get_account_assignments": return client.get("/userroles/assignments/account", { userRoleId: user_role_id, continuationToken: continuation_token });
      case "get_group_assignments":   return client.get("/userroles/assignments/usergroups", { userRoleId: user_role_id, continuationToken: continuation_token });
      default: throw new Error(`Unknown action for tv_user_role_assignments: ${action}`);
    }
  }

  if (name === "tv_user_groups") {
    const { group_id, name: groupName, pagination_token, limit } = args as {
      group_id?: string; name?: string; pagination_token?: string; limit?: number;
    };
    switch (action) {
      case "list":     return client.get("/usergroups", { paginationToken: pagination_token, limit });
      case "get":      return client.get(`/usergroups/${group_id}`);
      case "create":   return client.post("/usergroups", { name: groupName });
      case "update":   return client.put(`/usergroups/${group_id}`, { name: groupName });
      case "delete":   return client.delete(`/usergroups/${group_id}`);
      case "get_role": return client.get(`/usergroups/${group_id}/userroles`);
      default: throw new Error(`Unknown action for tv_user_groups: ${action}`);
    }
  }

  if (name === "tv_user_group_members") {
    const { group_id, account_id, account_ids, pagination_token, limit } = args as {
      group_id: string; account_id?: string; account_ids?: string[]; pagination_token?: string; limit?: number;
    };
    switch (action) {
      case "list":       return client.get(`/usergroups/${group_id}/members`, { paginationToken: pagination_token, limit });
      case "add":        return client.post(`/usergroups/${group_id}/members`, account_ids);
      case "remove":     return client.delete(`/usergroups/${group_id}/members`, account_ids);
      case "remove_one": return client.delete(`/usergroups/${group_id}/members/${account_id}`);
      default: throw new Error(`Unknown action for tv_user_group_members: ${action}`);
    }
  }

  // tv_user_roles
  const { user_role_id, name: roleName, permissions } = args as {
    user_role_id?: string; name?: string; permissions?: string[];
  };
  switch (action) {
    case "list":             return client.get("/userroles");
    case "get_permissions":  return client.get("/userroles/permissions");
    case "create":           return client.post("/userroles", { Name: roleName, Permissions: permissions });
    case "update":           return client.put("/userroles", { UserRoleId: user_role_id, Name: roleName, Permissions: permissions });
    case "delete":           return client.delete("/userroles", undefined, { userRoleId: user_role_id });
    case "get_predefined":   return client.get("/userroles/predefined");
    case "set_predefined":   return client.put(`/userroles/${user_role_id}/predefined`, {});
    case "clear_predefined": return client.delete("/userroles/predefined");
    default: throw new Error(`Unknown action for tv_user_roles: ${action}`);
  }
}
