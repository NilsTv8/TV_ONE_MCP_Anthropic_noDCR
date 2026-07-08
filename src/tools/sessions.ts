import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const sessionTools: Tool[] = [
  {
    name: "tv_sessions",
    description: `Manage TeamViewer service case sessions.

action values:
  list    — list sessions (optional: state: open|closed, tag)
  get     — get a session (required: session_code)
  create  — create a session (optional: description, end_customer, tag, notes, supporter_name)
  update  — update a session (required: session_code; optional: description, tag, notes)
  delete  — close/terminate a session (required: session_code)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete"] },
        session_code: { type: "string", description: "Session code" },
        state: { type: "string", enum: ["open", "closed"], description: "Filter by state (list)" },
        tag: { type: "string", description: "Session tag" },
        description: { type: "string", description: "Session description" },
        notes: { type: "string", description: "Internal notes" },
        supporter_name: { type: "string", description: "Supporter name (create)" },
        end_customer: { type: "object", description: "End customer info (create)", properties: { name: { type: "string" }, email: { type: "string" } } },
      },
    },
  },
];

export async function handleSessionTool(
  _name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action, session_code, state, tag, ...rest } = args as {
    action: string; session_code?: string; state?: string; tag?: string;
  } & Record<string, unknown>;
  switch (action) {
    case "list":   return client.get("/sessions", { state, tag });
    case "get":    return client.get(`/sessions/${session_code}`);
    case "create": return client.post("/sessions", rest);
    case "update": return client.put(`/sessions/${session_code}`, rest);
    case "delete": return client.delete(`/sessions/${session_code}`);
    default: throw new Error(`Unknown action for tv_sessions: ${action}`);
  }
}
