import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const permanentTokenTools: Tool[] = [
  {
    name: "tv_tokens",
    description: `Manage permanent (non-expiring) TeamViewer API tokens.

action values:
  create  — create a permanent token (required: name 5–20 chars; optional: scope)
            The returned token can be stored as TEAMVIEWER_API_TOKEN for use without OAuth.
  delete  — delete the permanent token for the current session (no params)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["create", "delete"] },
        name: { type: "string", description: "Token name (5–20 characters)" },
        scope: { type: "string", description: "Comma-separated scopes (optional)" },
      },
    },
  },
];

export async function handlePermanentTokenTool(
  _name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action, name, scope } = args as { action: string; name?: string; scope?: string };
  switch (action) {
    case "create": {
      const result = await client.createPermanentToken(name!, scope);
      return { message: "Permanent access token created. Store it securely — it will not be shown again.", access_token: result.AccessToken };
    }
    case "delete":
      await client.deletePermanentToken();
      return { message: "Permanent access token deleted." };
    default: throw new Error(`Unknown action for tv_tokens: ${action}`);
  }
}
