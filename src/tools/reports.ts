import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const reportTools: Tool[] = [
  {
    name: "tv_connection_reports",
    description: `Manage TeamViewer connection reports and media.

action values:
  list                  — list connection reports (optional: userid, groupid, deviceid, from_date, to_date, limit, offset)
  get                   — get a report (required: connection_id)
  update                — update report notes (required: connection_id; optional: notes)
  delete                — delete a report (required: connection_id)
  get_ai_summary        — get AI summary for a connection (required: connection_id)
  get_chat_transcript   — get chat transcript (required: connection_id)
  get_voice_transcript  — get voice transcript (required: connection_id)
  list_screenshots      — list screenshots (required: connection_id)
  get_screenshot        — download a screenshot (required: connection_id, screenshot_id)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "update", "delete", "get_ai_summary", "get_chat_transcript", "get_voice_transcript", "list_screenshots", "get_screenshot"] },
        connection_id: { type: "string", description: "Connection report ID" },
        screenshot_id: { type: "string", description: "Screenshot ID (get_screenshot)" },
        notes: { type: "string", description: "Notes to update (update)" },
        userid: { type: "string", description: "Filter by user ID (list)" },
        groupid: { type: "string", description: "Filter by group ID (list)" },
        deviceid: { type: "string", description: "Filter by device ID (list)" },
        from_date: { type: "string", description: "Start date ISO 8601 (list)" },
        to_date: { type: "string", description: "End date ISO 8601 (list)" },
        limit: { type: "number", description: "Max results up to 1000 (list)" },
        offset: { type: "number", description: "Pagination offset (list)" },
      },
    },
  },
  {
    name: "tv_list_device_reports",
    description: "Retrieves device inventory/activity reports.",
    inputSchema: {
      type: "object",
      properties: {
        from_date: { type: "string", description: "Start date (ISO 8601)" },
        to_date: { type: "string", description: "End date (ISO 8601)" },
      },
    },
  },
];

export async function handleReportTool(
  name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  if (name === "tv_list_device_reports") {
    return client.get("/reports/devices", args as Record<string, string | number | boolean | undefined>);
  }

  const { action, connection_id, screenshot_id, notes, ...rest } = args as {
    action: string; connection_id?: string; screenshot_id?: string; notes?: string;
  } & Record<string, unknown>;

  switch (action) {
    case "list":                 return client.get("/reports/connections", rest as Record<string, string | number | boolean | undefined>);
    case "get":                  return client.get(`/reports/connections/${connection_id}`);
    case "update":               return client.put(`/reports/connections/${connection_id}`, { notes });
    case "delete":               return client.delete(`/reports/connections/${connection_id}`);
    case "get_ai_summary":       return client.get(`/reports/connections/${connection_id}/ai-summary`);
    case "get_chat_transcript":  return client.get(`/reports/connections/${connection_id}/chat-transcript`);
    case "get_voice_transcript": return client.get(`/reports/connections/${connection_id}/voice-transcript`);
    case "list_screenshots":     return client.get(`/reports/connections/${connection_id}/screenshots`);
    case "get_screenshot":       return client.get(`/reports/connections/${connection_id}/${screenshot_id}/screenshot`);
    default: throw new Error(`Unknown action for tv_connection_reports: ${action}`);
  }
}
