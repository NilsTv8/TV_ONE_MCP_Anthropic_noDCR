#!/usr/bin/env node
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { TeamViewerClient } from "./client.js";
import { TeamViewerOAuthProvider } from "./auth-provider.js";

import { accountTools, handleAccountTool } from "./tools/account.js";
import { companyTools, handleCompanyTool } from "./tools/company.js";
import { deviceGroupTools, handleDeviceGroupTool } from "./tools/device-groups.js";
import { deviceTools, handleDeviceTool } from "./tools/devices.js";
import { contactTools, handleContactTool } from "./tools/contacts.js";
import { eventLoggingTools, handleEventLoggingTool } from "./tools/event-logging.js";
import { managedDeviceTools, handleManagedDeviceTool } from "./tools/managed-devices.js";
import { managedGroupTools, handleManagedGroupTool } from "./tools/managed-groups.js";
import { monitoringTools, handleMonitoringTool } from "./tools/monitoring.js";
import { policyTools, handlePolicyTool } from "./tools/policies.js";
import { reportTools, handleReportTool } from "./tools/reports.js";
import { sessionTools, handleSessionTool } from "./tools/sessions.js";
import { userTools, handleUserTool } from "./tools/users.js";
import { userRoleTools, handleUserRoleTool } from "./tools/user-roles.js";
import { permanentTokenTools, handlePermanentTokenTool } from "./tools/permanent-token.js";
import { remoteControlTools, handleRemoteControlTool } from "./tools/remote-control.js";

// ---------------------------------------------------------------------------
// Token context — carries the TV access token through async call chains so
// that tool handlers can call getClient() without explicit token passing.
// ---------------------------------------------------------------------------
const tokenContext = new AsyncLocalStorage<string>();

export function getClient(): TeamViewerClient {
  const envToken = process.env.TEAMVIEWER_API_TOKEN;
  if (envToken) return new TeamViewerClient(envToken);

  const token = tokenContext.getStore();
  if (token) return new TeamViewerClient(token);

  throw new Error(
    "Not authenticated. Connect via OAuth or set the TEAMVIEWER_API_TOKEN environment variable."
  );
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------
const ALL_TOOLS = [
  ...accountTools,
  ...companyTools,
  ...deviceGroupTools,
  ...deviceTools,
  ...contactTools,
  ...eventLoggingTools,
  ...managedDeviceTools,
  ...managedGroupTools,
  ...monitoringTools,
  ...policyTools,
  ...reportTools,
  ...sessionTools,
  ...userTools,
  ...userRoleTools,
  ...permanentTokenTools,
  ...remoteControlTools,
];

const TOOL_HANDLERS: Record<
  string,
  (name: string, args: Record<string, unknown>, client: TeamViewerClient) => Promise<unknown>
> = {
  ...Object.fromEntries(accountTools.map((t) => [t.name, handleAccountTool])),
  ...Object.fromEntries(companyTools.map((t) => [t.name, handleCompanyTool])),
  ...Object.fromEntries(deviceGroupTools.map((t) => [t.name, handleDeviceGroupTool])),
  ...Object.fromEntries(deviceTools.map((t) => [t.name, handleDeviceTool])),
  ...Object.fromEntries(contactTools.map((t) => [t.name, handleContactTool])),
  ...Object.fromEntries(eventLoggingTools.map((t) => [t.name, handleEventLoggingTool])),
  ...Object.fromEntries(managedDeviceTools.map((t) => [t.name, handleManagedDeviceTool])),
  ...Object.fromEntries(managedGroupTools.map((t) => [t.name, handleManagedGroupTool])),
  ...Object.fromEntries(monitoringTools.map((t) => [t.name, handleMonitoringTool])),
  ...Object.fromEntries(policyTools.map((t) => [t.name, handlePolicyTool])),
  ...Object.fromEntries(reportTools.map((t) => [t.name, handleReportTool])),
  ...Object.fromEntries(sessionTools.map((t) => [t.name, handleSessionTool])),
  ...Object.fromEntries(userTools.map((t) => [t.name, handleUserTool])),
  ...Object.fromEntries(userRoleTools.map((t) => [t.name, handleUserRoleTool])),
  ...Object.fromEntries(permanentTokenTools.map((t) => [t.name, handlePermanentTokenTool])),
};

// ---------------------------------------------------------------------------
// MCP Server factory — one instance per HTTP session
// ---------------------------------------------------------------------------
function createMcpServer(): Server {
  const server = new Server(
    { name: "teamviewer-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const typedArgs = args as Record<string, unknown>;

    if (name === "tv_connect_device") {
      try {
        const result = await handleRemoteControlTool(name, typedArgs);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }

    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    try {
      const client = getClient();
      const result = await handler(name, typedArgs, client);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// HTTP server setup
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const serverUrl = new URL(process.env.TEAMVIEWER_MCP_URL ?? `https://localhost:${PORT}`);

// createMcpExpressApp adds host-header protection for localhost bindings
const app = createMcpExpressApp({ host: "0.0.0.0" });
app.set("trust proxy", "loopback"); // ngrok agent connects from 127.0.0.1
app.use(express.json());

// ---------------------------------------------------------------------------
// OAuth — only mounted when TV OAuth credentials are configured.
// When present, mcpAuthRouter automatically creates:
//   GET /.well-known/oauth-protected-resource  (RFC 9728 — required for Anthropic connectors)
//   GET /.well-known/oauth-authorization-server (RFC 8414)
//   GET  /authorize
//   POST /token
//   POST /revoke
// Dynamic client registration (/register) is intentionally omitted.
// Pre-authorize MCP client IDs via TEAMVIEWER_ALLOWED_CLIENT_IDS (comma-separated).
// If unset, any client_id is accepted.
// ---------------------------------------------------------------------------
const mcpResourceUrl = new URL("/mcp", serverUrl);
const tvClientId = process.env.TEAMVIEWER_CLIENT_ID;
const tvClientSecret = process.env.TEAMVIEWER_CLIENT_SECRET;
if (tvClientId && !tvClientSecret || !tvClientId && tvClientSecret) {
  console.error("[teamviewer-mcp] FATAL: Both TEAMVIEWER_CLIENT_ID and TEAMVIEWER_CLIENT_SECRET must be set together.");
  process.exit(1);
}
const tvCallbackUrl = process.env.TEAMVIEWER_CALLBACK_URL;
let provider: TeamViewerOAuthProvider | undefined;

if (tvClientId && tvClientSecret) {
  provider = new TeamViewerOAuthProvider(tvClientId, tvClientSecret, serverUrl, tvCallbackUrl);

  // Record each client's redirect_uri before the SDK validates it — without DCR
  // there are no pre-registered clients, so we capture the URI here and return
  // it from getClient() so the SDK's redirect_uri check passes.
  app.use("/authorize", (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const p = req.method === "POST" ? req.body : req.query;
    const clientId = p.client_id as string | undefined;
    const redirectUri = p.redirect_uri as string | undefined;
    if (clientId && redirectUri) provider!.recordRedirectUri(clientId, redirectUri);
    next();
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: serverUrl,
      resourceServerUrl: mcpResourceUrl,
      scopesSupported: [
        "UserInfo.View",
        "Computers.View",
        "Computers.Edit",
        "Computers.Delete",
        "Groups.View",
        "Groups.Create",
        "Groups.Edit",
        "Groups.Delete",
        "Contacts.View",
        "Contacts.Create",
        "Contacts.Edit",
        "Contacts.Delete",
        "Partners.View",
        "Sessions.ManualCreation",
      ],
      resourceName: "TeamViewer MCP Server",
    })
  );

  // TeamViewer redirects the user here after they authorize in their browser.
  // We exchange the TV code for TV tokens and redirect the user back to Claude.
  app.get("/callback", async (req: express.Request, res: express.Response) => {
    const { code, state, error, error_description } =
      req.query as Record<string, string | undefined>;

    if (error) {
      res.status(400).send(errorHtml(`Authorization failed: ${error} — ${error_description ?? ""}`));
      return;
    }

    if (!code || !state) {
      res.status(400).send(errorHtml("Missing code or state in callback URL"));
      return;
    }

    try {
      const redirectUrl = await provider!.handleCallback(code, state);
      res.redirect(redirectUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[teamviewer-mcp] OAuth callback error:", msg);
      res.status(400).send(errorHtml(msg));
    }
  });
}

// ---------------------------------------------------------------------------
// MCP transport — one StreamableHTTPServerTransport per client session
// ---------------------------------------------------------------------------
const transports = new Map<string, StreamableHTTPServerTransport>();

async function handleMcpRequest(req: express.Request, res: express.Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // The bearer token is the TV access token, added by requireBearerAuth middleware.
  // Fall back to the static env var token for local development without OAuth.
  const authToken = (req as express.Request & { auth?: { token: string } }).auth?.token;
  const activeToken = authToken ?? process.env.TEAMVIEWER_API_TOKEN ?? "";

  // SSE stream reconnect
  if (req.method === "GET") {
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await tokenContext.run(activeToken, () => transport.handleRequest(req, res));
    return;
  }

  // Session teardown
  if (req.method === "DELETE") {
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.close();
        transports.delete(sessionId);
      }
    }
    res.status(200).end();
    return;
  }

  // New or existing POST — resume session or create a new transport
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    const newTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, newTransport);
      },
    });

    newTransport.onclose = () => {
      if (newTransport.sessionId) transports.delete(newTransport.sessionId);
    };

    const server = createMcpServer();
    await server.connect(newTransport);
    transport = newTransport;
  }

  await tokenContext.run(activeToken, () =>
    transport!.handleRequest(req, res, req.body)
  );
}

// Bearer auth guard — applied when OAuth is configured.
// initialize is exempt so Claude can verify reachability before OAuth completes.
const mcpCors = cors({ origin: "*", allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id"] });

// Normalize Accept header before the SDK sees it. The SDK checks literally for
// "application/json" and "text/event-stream"; wildcard "*/*" triggers a 406.
// @hono/node-server converts rawHeaders (not req.headers) to a web Request, so
// we must patch rawHeaders directly.
const normalizeAccept: express.RequestHandler = (req, _res, next) => {
  const raw = req.rawHeaders;
  const idx = raw.findIndex((v, i) => i % 2 === 0 && v.toLowerCase() === "accept");
  const current = idx !== -1 ? raw[idx + 1] : "";
  const needed = "application/json, text/event-stream";
  if (!current.includes("application/json") || !current.includes("text/event-stream")) {
    if (idx !== -1) {
      raw[idx + 1] = needed;
    } else {
      raw.push("accept", needed);
    }
    req.headers["accept"] = needed;
  }
  next();
};

const mcpMiddleware: express.RequestHandler[] = [mcpCors, normalizeAccept];
if (provider) {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpResourceUrl);

  // RFC 6750 §3.1 compliant bearer auth:
  // Only tools/call requires authentication — all other methods (initialize,
  // tools/list, ping, etc.) are allowed through so OAuth is only triggered
  // when a tool is actually invoked, not at connection time.
  const customBearerAuth: express.RequestHandler = async (req, res, next) => {
    const method = (req.body as Record<string, unknown>)?.method;
    if (req.method !== "POST" || method !== "tools/call") {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401)
        .set("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`)
        .json({ error: "authentication_required", error_description: "Bearer token required" });
      return;
    }
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401)
        .set("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`)
        .json({ error: "invalid_token", error_description: "Invalid authorization scheme" });
      return;
    }
    const token = authHeader.slice(7);
    try {
      const authInfo = await provider!.verifyAccessToken(token);
      (req as express.Request & { auth?: typeof authInfo }).auth = authInfo;
      next();
    } catch {
      res.status(401)
        .set("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`)
        .json({ error: "invalid_token", error_description: "Invalid or expired access token" });
    }
  };

  mcpMiddleware.push(customBearerAuth);
} else if (!process.env.TEAMVIEWER_API_TOKEN) {
  console.warn(
    "[teamviewer-mcp] WARNING: No authentication configured. " +
      "Set TEAMVIEWER_CLIENT_ID + TEAMVIEWER_CLIENT_SECRET (OAuth) " +
      "or TEAMVIEWER_API_TOKEN (static token)."
  );
}

app.all("/mcp", ...mcpMiddleware, handleMcpRequest as express.RequestHandler);
app.all("/", ...mcpMiddleware, handleMcpRequest as express.RequestHandler);

// Catch body-parser JSON errors and any other unhandled errors — never expose stack traces.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as NodeJS.ErrnoException & { status?: number }).status ?? 500;
  const isBadJson = err instanceof SyntaxError && "body" in err;
  res.status(isBadJson ? 400 : status).json({ error: isBadJson ? "Invalid JSON" : "Internal server error" });
});

// TLS is terminated by Azure App Service — the server always listens on plain HTTP.
function startServer(): void {
  const base = serverUrl.href.replace(/\/$/, "");
  const onListen = () => {
    console.error(`[teamviewer-mcp] Listening on port ${PORT} (HTTP)`);
    console.error(`[teamviewer-mcp] MCP endpoint : ${base}/mcp`);
    if (provider) {
      const callbackDisplayUrl = tvCallbackUrl ?? `${base}/callback`;
      console.error(`[teamviewer-mcp] Protected resource metadata : ${base}/.well-known/oauth-protected-resource`);
      console.error(`[teamviewer-mcp] Authorization server metadata: ${base}/.well-known/oauth-authorization-server`);
      console.error(`[teamviewer-mcp] OAuth callback (register with TeamViewer): ${callbackDisplayUrl}`);
    }
  };
  app.listen(PORT, "0.0.0.0", onListen);
}

startServer();

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Authorization Error — TeamViewer MCP</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5}
.card{background:#fff;border-radius:8px;padding:40px 48px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:480px;text-align:center}
h1{color:#c0392b}p{color:#555}</style></head>
<body><div class="card"><h1>Authorization Error</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}
