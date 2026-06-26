# TeamViewer MCP Server

## Repos

| Variant | Repo | Folder | Branch |
|---|---|---|---|
| **DCR (main)** | `NilsTv8/TV_ONE_MCP_Anthropic` | `~/TV_ONE_MCP_Anthropic` | `master` |
| **No-DCR** | `NilsTv8/TV_ONE_MCP_Anthropic_noDCR` | `~/TV_ONE_MCP_noDCR` | `master` |

**This repo is the no-DCR variant.** It accepts any `client_id` (capture-redirect-uri pattern). Use this for Copilot Studio, which does not support Dynamic Client Registration (RFC 7591).

The **DCR** variant requires clients to register at `/register` first. Use this for clients that support DCR (e.g. Claude.ai connectors).

## Architecture

The server is an OAuth 2.0 proxy between MCP clients and TeamViewer:

```
MCP client (Claude / Copilot Studio)
    ↕ OAuth via /authorize, /token (MCP server endpoints)
MCP server  (this repo)
    ↕ OAuth via login.teamviewer.com + webapi.teamviewer.com
TeamViewer
```

MCP endpoint: `POST /mcp`  
Tools listing requires no auth; tool execution requires a valid TV bearer token.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TEAMVIEWER_CLIENT_ID` | Yes | TV OAuth app client ID |
| `TEAMVIEWER_CLIENT_SECRET` | Yes | TV OAuth app client secret |
| `TEAMVIEWER_MCP_URL` | Yes | Public base URL of this server (no trailing slash) |
| `TEAMVIEWER_CALLBACK_URL` | No | OAuth callback URL (defaults to `{MCP_URL}/callback`) |
| `PORT` | No | HTTP port (default: 3000) |
| `TEAMVIEWER_API_TOKEN` | No | Static TV token — bypasses OAuth entirely |

## Running Locally

Requires ngrok with static domain `delinda-microelectrophoretic-detra.ngrok-free.dev`.

```bash
# Terminal 1 — ngrok tunnel
ngrok http --domain=delinda-microelectrophoretic-detra.ngrok-free.dev 3000

# Terminal 2 — MCP server
npm run build
TEAMVIEWER_CLIENT_ID=<id> \
TEAMVIEWER_CLIENT_SECRET=<secret> \
TEAMVIEWER_CALLBACK_URL=https://delinda-microelectrophoretic-detra.ngrok-free.dev/callback \
TEAMVIEWER_MCP_URL=https://delinda-microelectrophoretic-detra.ngrok-free.dev \
PORT=3000 node dist/index.js
```

MCP endpoint (local): `https://delinda-microelectrophoretic-detra.ngrok-free.dev/mcp`

## Production (Azure)

Hosted on Azure App Service with a Docker container. Azure terminates TLS — the server runs plain HTTP internally. No `src/tls.ts` needed.

Deploy by pushing to the repo; Azure pulls the image automatically.

## OAuth Endpoints (auto-served by mcpAuthRouter)

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 resource metadata |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 AS metadata |
| `GET /authorize` | Start OAuth flow → redirects to TeamViewer |
| `POST /token` | Exchange code for tokens |
| `POST /revoke` | Revoke tokens |
| `POST /register` | DCR (DCR variant only) |
| `GET /callback` | TV redirects here after user login |

## TeamViewer OAuth App

Register at: https://login.teamviewer.com → Integrations → Apps  
Callback URL to register: `{TEAMVIEWER_MCP_URL}/callback`  
`skipLocalPkceValidation = true` — the MCP SDK validates PKCE; the server passes `undefined` codeVerifier to `exchangeAuthorizationCode`.

## Key Design Decisions

- **No server-side TLS** — Azure App Service provides HTTPS termination
- **`trust proxy loopback`** — ngrok sends `X-Forwarded-For` from 127.0.0.1
- **`tools/list` unauthenticated** — only `tools/call` requires a bearer token
- **5-min token cache** — `verifyAccessToken` caches TV API responses to reduce latency
- **BoundedMap** — all in-memory stores are capped to prevent unbounded growth
- **`display=popup`** on TV authorize URL — opens login in a popup rather than full redirect
