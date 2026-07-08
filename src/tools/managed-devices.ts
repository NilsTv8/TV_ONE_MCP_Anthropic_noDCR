import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const managedDeviceTools: Tool[] = [
  {
    name: "tv_managed_devices",
    description: `Manage TeamViewer managed devices.

action values:
  list                  — list directly managed devices (optional: pagination_token)
  list_company          — list company-managed devices (optional: pagination_token)
  get                   — get a managed device (required: device_id)
  get_assignment_data   — get assignment data for onboarding (no params)
  update                — update a managed device (required: device_id; optional: name, teamviewerPolicyId, managedGroupId, permissionInheritanceType)
  update_description    — update device description (required: device_id, description)
  delete                — remove device management (required: device_id)
  remove_policy         — remove assigned policy (required: device_id)
  get_groups            — list managed groups the device belongs to (required: device_id)
  update_groups         — edit device group memberships (required: device_id; optional: added_chain_ids[], removed_chain_ids[])`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "list_company", "get", "get_assignment_data", "update", "update_description", "delete", "remove_policy", "get_groups", "update_groups"] },
        device_id: { type: "string", description: "Managed device ID (UUID)" },
        pagination_token: { type: "string", description: "Pagination token" },
        name: { type: "string", description: "Device name (update)" },
        description: { type: "string", description: "Device description (update_description)" },
        teamviewerPolicyId: { type: "string", description: "Policy ID to assign (update)" },
        managedGroupId: { type: "string", description: "Group ID to assign to (update)" },
        permissionInheritanceType: { type: "number", description: "0 = inherit from group, 1 = no inheritance (update)" },
        added_chain_ids: { type: "array", items: { type: "string" }, description: "Group chain IDs to add (update_groups)" },
        removed_chain_ids: { type: "array", items: { type: "string" }, description: "Group chain IDs to remove (update_groups)" },
      },
    },
  },
  {
    name: "tv_managed_device_managers",
    description: `Manage direct managers of a managed device.

action values:
  list    — list managers of a device (required: device_id)
  add     — add managers to a device (required: device_id, managers[])
  remove  — remove a manager from a device (required: device_id, manager_id)`,
    inputSchema: {
      type: "object",
      required: ["action", "device_id"],
      properties: {
        action: { type: "string", enum: ["list", "add", "remove"] },
        device_id: { type: "string", description: "Managed device ID (UUID)" },
        manager_id: { type: "string", description: "Manager account ID to remove (remove)" },
        managers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              permissions: { type: "array", items: { type: "string" } },
            },
          },
          description: "Managers to add with their permissions (add)",
        },
      },
    },
  },
];

export async function handleManagedDeviceTool(
  name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  if (name === "tv_managed_device_managers") {
    const { action, device_id, manager_id, managers } = args as {
      action: string; device_id: string; manager_id?: string; managers?: unknown[];
    };
    switch (action) {
      case "list":   return client.get(`/managed/devices/${device_id}/managers`);
      case "add":    return client.post(`/managed/devices/${device_id}/managers`, managers);
      case "remove": return client.delete(`/managed/devices/${device_id}/managers/${manager_id}`);
      default: throw new Error(`Unknown action for tv_managed_device_managers: ${action}`);
    }
  }

  const { action, device_id, pagination_token, description, added_chain_ids, removed_chain_ids, ...rest } = args as {
    action: string; device_id?: string; pagination_token?: string; description?: string;
    added_chain_ids?: string[]; removed_chain_ids?: string[];
  } & Record<string, unknown>;

  switch (action) {
    case "list":               return client.get("/managed/devices", { paginationToken: pagination_token });
    case "list_company":       return client.get("/managed/devices/company", { paginationToken: pagination_token });
    case "get":                return client.get(`/managed/devices/${device_id}`);
    case "get_assignment_data": return client.get("/managed/devices/assignment-data");
    case "update":             return client.put(`/managed/devices/${device_id}`, rest);
    case "update_description": return client.put(`/managed/devices/${device_id}/description`, { deviceDescription: description });
    case "delete":             return client.delete(`/managed/devices/${device_id}`);
    case "remove_policy":      return client.put(`/managed/devices/${device_id}/policy/remove`, {});
    case "get_groups":         return client.get(`/managed/devices/${device_id}/groups`);
    case "update_groups":      return client.put(`/managed/devices/${device_id}/groups`, { AddedChainIds: added_chain_ids, RemovedChainIds: removed_chain_ids });
    default: throw new Error(`Unknown action for tv_managed_devices: ${action}`);
  }
}
