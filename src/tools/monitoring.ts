import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const monitoringTools: Tool[] = [
  {
    name: "tv_monitoring",
    description: `Manage TeamViewer monitoring and device information.

action values:
  list_alarms      — list monitoring alarms (optional: status, device_id, group_id, start_date, end_date, continuation_token)
  list_devices     — list devices with monitoring enabled (no params)
  activate         — activate monitoring on a device (required: teamviewer_id; optional: monitoring_policy_id, patch_management_policy_id)
  get_hardware     — get hardware info for a monitored device (required: device_id)
  get_system_info  — get OS/hostname info for a monitored device (required: device_id)
  get_software     — get installed software for a monitored device (required: device_id)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list_alarms", "list_devices", "activate", "get_hardware", "get_system_info", "get_software"] },
        device_id: { type: "string", description: "Device ID (UUID) — get_hardware, get_system_info, get_software" },
        teamviewer_id: { type: "number", description: "TeamViewer numeric device ID — activate" },
        monitoring_policy_id: { type: "string", description: "Monitoring policy ID — activate" },
        patch_management_policy_id: { type: "string", description: "Patch management policy ID — activate" },
        status: { type: "string", description: "Alarm status filter (list_alarms)" },
        group_id: { type: "string", description: "Group ID filter (list_alarms)" },
        start_date: { type: "string", description: "ISO 8601 start date (list_alarms)" },
        end_date: { type: "string", description: "ISO 8601 end date (list_alarms)" },
        continuation_token: { type: "string", description: "Pagination token (list_alarms)" },
      },
    },
  },
];

export async function handleMonitoringTool(
  _name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action, device_id, teamviewer_id, monitoring_policy_id, patch_management_policy_id,
    status, group_id, start_date, end_date, continuation_token } = args as {
    action: string; device_id?: string; teamviewer_id?: number;
    monitoring_policy_id?: string; patch_management_policy_id?: string;
    status?: string; group_id?: string; start_date?: string; end_date?: string; continuation_token?: string;
  };
  switch (action) {
    case "list_alarms":
      return client.get("/monitoring/alarms", {
        "parameters.status": status,
        "parameters.deviceId": device_id,
        "parameters.groupId": group_id,
        "parameters.startDate": start_date,
        "parameters.endDate": end_date,
        "parameters.continuationToken": continuation_token,
      });
    case "list_devices":    return client.get("/monitoring/devices");
    case "activate":        return client.post("/monitoring/devices", { teamviewer_id, monitoring_policy_id, patch_management_policy_id });
    case "get_hardware":    return client.get(`/monitoring/devices/${device_id}/hardware`);
    case "get_system_info": return client.get(`/monitoring/devices/${device_id}/information`);
    case "get_software":    return client.get(`/monitoring/devices/${device_id}/software`);
    default: throw new Error(`Unknown action for tv_monitoring: ${action}`);
  }
}
