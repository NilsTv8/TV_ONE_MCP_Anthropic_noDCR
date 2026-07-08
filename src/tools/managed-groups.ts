import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const managedGroupTools: Tool[] = [
  {
    name: "tv_managed_groups",
    description: `Manage TeamViewer managed device groups.

action values:
  list    — list managed groups (optional: limit, offset)
  get     — get a group (required: group_id)
  create  — create a group (required: name; optional: policy_id)
  update  — update a group (required: group_id; optional: name, policy_id)
  delete  — delete a group (required: group_id)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete"] },
        group_id: { type: "string", description: "Managed group ID" },
        name: { type: "string", description: "Group name" },
        policy_id: { type: "string", description: "Policy ID to assign" },
        limit: { type: "number", description: "Max results (list)" },
        offset: { type: "number", description: "Pagination offset (list)" },
      },
    },
  },
  {
    name: "tv_managed_group_managers",
    description: `Manage managers assigned to a managed group.

action values:
  list    — list managers (required: group_id)
  add     — add managers (required: group_id; optional: account_ids[], permissions[])
  update  — update manager permissions (required: group_id; optional: account_ids[], permissions[])
  remove  — remove managers (required: group_id, account_ids[])`,
    inputSchema: {
      type: "object",
      required: ["action", "group_id"],
      properties: {
        action: { type: "string", enum: ["list", "add", "update", "remove"] },
        group_id: { type: "string", description: "Managed group ID" },
        account_ids: { type: "array", items: { type: "string" }, description: "Account IDs" },
        permissions: { type: "array", items: { type: "string" }, description: "Permissions to grant/update" },
      },
    },
  },
];

export async function handleManagedGroupTool(
  name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  if (name === "tv_managed_group_managers") {
    const { action, group_id, account_ids, permissions } = args as {
      action: string; group_id: string; account_ids?: string[]; permissions?: string[];
    };
    switch (action) {
      case "list":   return client.get(`/managed/groups/${group_id}/managers`);
      case "add":    return client.post(`/managed/groups/${group_id}/managers`, { account_ids, permissions });
      case "update": return client.put(`/managed/groups/${group_id}/managers`, { account_ids, permissions });
      case "remove": return client.delete(`/managed/groups/${group_id}/managers`, { account_ids });
      default: throw new Error(`Unknown action for tv_managed_group_managers: ${action}`);
    }
  }

  const { action, group_id, name: groupName, policy_id, limit, offset } = args as {
    action: string; group_id?: string; name?: string; policy_id?: string; limit?: number; offset?: number;
  };
  switch (action) {
    case "list":   return client.get("/managed/groups", { limit, offset });
    case "get":    return client.get(`/managed/groups/${group_id}`);
    case "create": return client.post("/managed/groups", { name: groupName, policy_id });
    case "update": return client.put(`/managed/groups/${group_id}`, { name: groupName, policy_id });
    case "delete": return client.delete(`/managed/groups/${group_id}`);
    default: throw new Error(`Unknown action for tv_managed_groups: ${action}`);
  }
}
