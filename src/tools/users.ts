import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const userTools: Tool[] = [
  {
    name: "tv_users",
    description: `Manage TeamViewer company users.

action values:
  list    — list users (optional: email, name, permissions, full_list)
  get     — get a user (required: user_id)
  create  — create a user (required: email, name, language; optional: password, userRoleId, license_key, log_sessions, show_comment_window, tfa_enforcement)
  update  — update a user (required: user_id; optional: email, name, password, active, AssignUserRoleIds[], UnassignUserRoleIds[], log_sessions, show_comment_window, tfa_enforcement, license_key)
  delete  — delete a user (required: user_id; optional: is_permanent_delete)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete"] },
        user_id: { type: "string", description: "User ID (e.g. 'u123456')" },
        email: { type: "string" },
        name: { type: "string" },
        language: { type: "string", description: "Language code (e.g. 'en')" },
        password: { type: "string" },
        active: { type: "boolean", description: "Activate or deactivate user (update)" },
        permissions: { type: "string", description: "Filter by permission (list)" },
        full_list: { type: "boolean", description: "Include deactivated users (list)" },
        is_permanent_delete: { type: "boolean", description: "Permanently delete vs deactivate (delete)" },
        userRoleId: { type: "string", description: "Role ID to assign (create)" },
        AssignUserRoleIds: { type: "array", items: { type: "string" }, description: "Role IDs to assign (update)" },
        UnassignUserRoleIds: { type: "array", items: { type: "string" }, description: "Role IDs to unassign (update)" },
        license_key: { type: "string" },
        log_sessions: { type: "boolean" },
        show_comment_window: { type: "boolean" },
        tfa_enforcement: { type: "boolean" },
      },
    },
  },
  {
    name: "tv_deactivate_user_tfa",
    description: "Deactivates two-factor authentication for a user.",
    inputSchema: {
      type: "object",
      required: ["user_id"],
      properties: {
        user_id: { type: "string", description: "User ID" },
      },
    },
  },
  {
    name: "tv_get_user_effective_permissions",
    description: "Returns the consolidated permissions from all roles assigned to the current user.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tv_get_user_roles",
    description: "Returns the roles assigned to a specific user.",
    inputSchema: {
      type: "object",
      required: ["user_id"],
      properties: {
        user_id: { type: "string", description: "User ID" },
        pagination_token: { type: "string" },
      },
    },
  },
  {
    name: "tv_respond_to_join_company_request",
    description: "Approves or rejects a user's request to join the company.",
    inputSchema: {
      type: "object",
      required: ["user_id", "approve"],
      properties: {
        user_id: { type: "string" },
        approve: { type: "boolean", description: "true to approve, false to reject" },
      },
    },
  },
];

export async function handleUserTool(
  name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  if (name === "tv_deactivate_user_tfa")
    return client.delete(`/users/${args.user_id}/tfa`);
  if (name === "tv_get_user_effective_permissions")
    return client.get("/users/effectivepermissions");
  if (name === "tv_get_user_roles")
    return client.get(`/users/${args.user_id}/userroles`, { paginationToken: args.pagination_token as string | undefined });
  if (name === "tv_respond_to_join_company_request")
    return client.post("/users/respondtojointocompanyrequest", { userId: args.user_id, approve: args.approve });

  const { action, user_id, email, name: userName, permissions, full_list, is_permanent_delete, ...rest } = args as {
    action: string; user_id?: string; email?: string; name?: string;
    permissions?: string; full_list?: boolean; is_permanent_delete?: boolean;
  } & Record<string, unknown>;
  switch (action) {
    case "list":   return client.get("/users", { email, name: userName, permissions, full_list });
    case "get":    return client.get(`/users/${user_id}`);
    case "create": return client.post("/users", { email, name: userName, ...rest });
    case "update": return client.put(`/users/${user_id}`, rest);
    case "delete": return client.delete(`/users/${user_id}`, undefined, { isPermanentDelete: is_permanent_delete });
    default: throw new Error(`Unknown action for tv_users: ${action}`);
  }
}
