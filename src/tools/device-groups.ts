import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const deviceGroupTools: Tool[] = [
  {
    name: "tv_device_groups",
    description: `Manage TeamViewer device groups.

action values:
  list     — list groups (optional: name, shared, shouldMatchFullName)
  get      — get a group (required: group_id)
  create   — create a group (required: name)
  update   — update a group (required: group_id; optional: name)
  delete   — delete a group (required: group_id)
  share    — share a group with users (required: group_id, users[])
  unshare  — remove group sharing (required: group_id; optional: users[])`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "share", "unshare"] },
        group_id: { type: "string", description: "Group ID" },
        name: { type: "string", description: "Group name" },
        shared: { type: "boolean", description: "Filter shared groups only (list)" },
        shouldMatchFullName: { type: "boolean", description: "Exact name match (list)" },
        users: { type: "array", items: { type: "string" }, description: "Account IDs to share/unshare with" },
      },
    },
  },
];

export async function handleDeviceGroupTool(
  _name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action, group_id, name, shared, shouldMatchFullName, users } = args as {
    action: string;
    group_id?: string;
    name?: string;
    shared?: boolean;
    shouldMatchFullName?: boolean;
    users?: string[];
  };
  switch (action) {
    case "list":    return client.get("/groups", { name, shared, shouldMatchFullName });
    case "get":     return client.get(`/groups/${group_id}`);
    case "create":  return client.post("/groups", { name });
    case "update":  return client.put(`/groups/${group_id}`, { name });
    case "delete":  return client.delete(`/groups/${group_id}`);
    case "share":   return client.post(`/groups/${group_id}/share_group`, { users });
    case "unshare": return client.post(`/groups/${group_id}/unshare_group`, users ? { users } : {});
    default: throw new Error(`Unknown action for tv_device_groups: ${action}`);
  }
}
