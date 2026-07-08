import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const contactTools: Tool[] = [
  {
    name: "tv_contacts",
    description: `Manage TeamViewer contacts.

action values:
  list    — list contacts (optional: online_state: Online|Busy|Away|Offline)
  get     — get a contact (required: contact_id)
  create  — invite a new contact (required: email; optional: groupid)
  delete  — remove a contact (required: contact_id)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "delete"] },
        contact_id: { type: "string", description: "Contact ID" },
        email: { type: "string", description: "Email address (create)" },
        groupid: { type: "string", description: "Group ID to assign contact to (create)" },
        online_state: { type: "string", enum: ["Online", "Busy", "Away", "Offline"], description: "Filter by online state (list)" },
      },
    },
  },
];

export async function handleContactTool(
  _name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action, contact_id, email, groupid, online_state } = args as {
    action: string;
    contact_id?: string;
    email?: string;
    groupid?: string;
    online_state?: string;
  };
  switch (action) {
    case "list":   return client.get("/contacts", { online_state });
    case "get":    return client.get(`/contacts/${contact_id}`);
    case "create": return client.post("/contacts", { email, groupid });
    case "delete": return client.delete(`/contacts/${contact_id}`);
    default: throw new Error(`Unknown action for tv_contacts: ${action}`);
  }
}
