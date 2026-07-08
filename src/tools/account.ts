import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const accountTools: Tool[] = [
  {
    name: "tv_account",
    description: `Manage the TeamViewer account associated with the API token.

action values:
  get             — get account details (no params)
  update          — update account settings (optional: email, name, password)
  create          — create a new account (required: email, password, name; optional: language)
  get_tenant_ids  — get tenant associations (no params)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["get", "update", "create", "get_tenant_ids"] },
        email: { type: "string", description: "Email address" },
        name: { type: "string", description: "Display name" },
        password: { type: "string", description: "Password" },
        language: { type: "string", description: "Language code (e.g. 'en')" },
      },
    },
  },
];

export async function handleAccountTool(
  _name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action, ...rest } = args as { action: string } & Record<string, unknown>;
  switch (action) {
    case "get":          return client.get("/account");
    case "update":       return client.put("/account", rest);
    case "create":       return client.post("/account", rest);
    case "get_tenant_ids": return client.get("/account/TenantIds");
    default: throw new Error(`Unknown action for tv_account: ${action}`);
  }
}
