import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TeamViewerClient } from "../client.js";

export const policyTools: Tool[] = [
  {
    name: "tv_teamviewer_policies",
    description: `Manage TeamViewer configuration policies.

action values:
  list    — list all policies (no params)
  get     — get a policy (required: policy_id)
  create  — create a policy (required: name; optional: settings[], default)
  update  — update a policy (required: policy_id; optional: name, settings[], default)
  delete  — delete a policy (required: policy_id)`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete"] },
        policy_id: { type: "string", description: "Policy ID" },
        name: { type: "string", description: "Policy name" },
        settings: { type: "array", items: { type: "object" }, description: "Policy setting objects" },
        default: { type: "boolean", description: "Set as default policy" },
      },
    },
  },
  {
    name: "tv_monitoring_policies",
    description: `Manage monitoring policies.

action values:
  list    — list monitoring policies (no params)
  get     — get a monitoring policy (required: policy_id)
  assign  — assign policies to devices/groups (required: assignments[])`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "assign"] },
        policy_id: { type: "string", description: "Monitoring policy ID" },
        assignments: { type: "array", items: { type: "object" }, description: "Assignment objects (assign)" },
      },
    },
  },
  {
    name: "tv_patch_policies",
    description: `Manage patch management policies.

action values:
  list    — list patch management policies (no params)
  get     — get a patch management policy (required: policy_id)
  assign  — assign policies to devices/groups (required: assignments[])`,
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "assign"] },
        policy_id: { type: "string", description: "Patch management policy ID" },
        assignments: { type: "array", items: { type: "object" }, description: "Assignment objects (assign)" },
      },
    },
  },
];

export async function handlePolicyTool(
  name: string,
  args: Record<string, unknown>,
  client: TeamViewerClient
): Promise<unknown> {
  const { action, policy_id, assignments, ...rest } = args as {
    action: string; policy_id?: string; assignments?: unknown[];
  } & Record<string, unknown>;

  if (name === "tv_monitoring_policies") {
    switch (action) {
      case "list":   return client.get("/Monitoring/Policy");
      case "get":    return client.get(`/Monitoring/Policy/${policy_id}`);
      case "assign": return client.post("/Monitoring/Policy/Assign", assignments);
      default: throw new Error(`Unknown action for tv_monitoring_policies: ${action}`);
    }
  }

  if (name === "tv_patch_policies") {
    switch (action) {
      case "list":   return client.get("/PatchManagement/Policy");
      case "get":    return client.get(`/PatchManagement/Policy/${policy_id}`);
      case "assign": return client.post("/PatchManagement/Policy/Assign", assignments);
      default: throw new Error(`Unknown action for tv_patch_policies: ${action}`);
    }
  }

  switch (action) {
    case "list":   return client.get("/TeamViewerPolicies");
    case "get":    return client.get(`/TeamViewerPolicies/${policy_id}`);
    case "create": return client.post("/TeamViewerPolicies", rest);
    case "update": return client.put(`/TeamViewerPolicies/${policy_id}`, rest);
    case "delete": return client.delete(`/TeamViewerPolicies/${policy_id}`);
    default: throw new Error(`Unknown action for tv_teamviewer_policies: ${action}`);
  }
}
