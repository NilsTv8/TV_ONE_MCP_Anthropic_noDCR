import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const remoteControlTools: Tool[] = [
  {
    name: "tv_connect_device",
    description:
      "Returns the TeamViewer remote control link for a device. " +
      "The teamviewer_id is the numeric TV ID visible on the managed device (e.g. from tv_list_managed_devices or tv_get_managed_device). " +
      "The caller is responsible for opening the link on the user's own machine to launch the TeamViewer desktop app.",
    inputSchema: {
      type: "object",
      required: ["teamviewer_id"],
      properties: {
        teamviewer_id: {
          type: "string",
          description: "The TeamViewer ID of the remote device (numeric, e.g. '123456789')",
        },
      },
    },
  },
];

export async function handleRemoteControlTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name !== "tv_connect_device") {
    throw new Error(`Unknown remote control tool: ${name}`);
  }

  const { teamviewer_id } = args as { teamviewer_id: string };

  if (!teamviewer_id || !/^\d+$/.test(teamviewer_id.replace(/\s/g, ""))) {
    throw new Error("teamviewer_id must be a numeric TeamViewer ID (digits only)");
  }

  const tvId = teamviewer_id.replace(/\s/g, "");
  const url = `teamviewerapi://remotecontrol/?remotecontrolid=${tvId}&thirdpartyname=tv_claude`;

  return {
    message: `Remote control link generated for device ${tvId}. Open this link on your machine to start the session.`,
    url,
  };
}
