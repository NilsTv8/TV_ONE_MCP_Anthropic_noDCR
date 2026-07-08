import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const companyTools: Tool[] = [
  {
    name: "tv_company",
    description: `Manage the company associated with the API token.

action values:
  get          — get company details (no params)
  update       — update company info (optional: name, email)
  get_license  — get company licensing data (no params)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["get", "update", "get_license"] },
        name: { type: "string", description: "Company name" },
        email: { type: "string", description: "Company email" },
      },
    },
  },
];

export async function handleCompanyTool(
  _name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action, ...rest } = args as { action: string } & Record<string, unknown>;
  switch (action) {
    case "get":         return client.get("/company");
    case "update":      return client.put("/company", rest);
    case "get_license": return client.get("/company/license");
    default: throw new Error(`Unknown action for tv_company: ${action}`);
  }
}
