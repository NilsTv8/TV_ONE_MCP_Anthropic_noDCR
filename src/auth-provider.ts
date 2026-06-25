import { randomBytes, createHash } from "crypto";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidTokenError,
  InvalidGrantError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";

const TV_AUTHORIZE_URL = "https://login.teamviewer.com/oauth2/authorize";
const TV_TOKEN_URL = "https://webapi.teamviewer.com/api/v1/OAuth2/token";
const TV_REVOKE_URL = "https://webapi.teamviewer.com/api/v1/OAuth2/revoke";
const TV_ACCOUNT_URL = "https://webapi.teamviewer.com/api/v1/account";

interface PendingAuth {
  clientRedirectUri: string;
  codeChallenge: string;
  scopes?: string[];
}

interface PendingCode {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  codeChallenge: string;
}

interface TokenCacheEntry {
  authInfo: AuthInfo;
  cachedAt: number;
}

const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly maxSize: number) { super(); }
  set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.maxSize) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    return super.set(key, value);
  }
}

/**
 * OAuth provider that proxies the authorization flow to TeamViewer.
 *
 * TeamViewer uses a non-standard token exchange format (JSON body with numeric grant_type),
 * so we cannot use the SDK's ProxyOAuthServerProvider. Instead:
 *  - authorize() redirects to TeamViewer with OUR client credentials and a /callback redirect_uri
 *  - handleCallback() is called by the /callback Express route; it exchanges the TV code
 *    and issues our own MCP authorization code to the MCP client (Claude)
 *  - exchangeAuthorizationCode() redeems the MCP code and returns the TV tokens to Claude
 *  - verifyAccessToken() validates TV bearer tokens on every MCP request (with 5-min cache)
 */
export class TeamViewerOAuthProvider implements OAuthServerProvider {
  readonly skipLocalPkceValidation = true;

  private readonly pendingAuths = new BoundedMap<string, PendingAuth>(1000);
  private readonly pendingCodes = new BoundedMap<string, PendingCode>(1000);
  private readonly tokenCache = new BoundedMap<string, TokenCacheEntry>(10000);
  private readonly tokenExpiry = new BoundedMap<string, number>(10000);
  private readonly knownRedirectUris = new BoundedMap<string, string>(1000);

  constructor(
    private readonly tvClientId: string,
    private readonly tvClientSecret: string,
    private readonly issuerUrl: URL,
    private readonly callbackUrl?: string
  ) {}

  recordRedirectUri(clientId: string, redirectUri: string): void {
    this.knownRedirectUris.set(clientId, redirectUri);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (id): Promise<OAuthClientInformationFull | undefined> => {
        const redirectUri = this.knownRedirectUris.get(id);
        return {
          client_id: id,
          redirect_uris: redirectUri ? [redirectUri] : [],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        };
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async authorize(_client: OAuthClientInformationFull, params: AuthorizationParams, res: any): Promise<void> {
    const state = params.state ?? randomBytes(16).toString("hex");

    this.pendingAuths.set(state, {
      clientRedirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes,
    });

    const tvUrl = new URL(TV_AUTHORIZE_URL);
    tvUrl.searchParams.set("response_type", "code");
    tvUrl.searchParams.set("client_id", this.tvClientId);
    tvUrl.searchParams.set("redirect_uri", this.callbackUrl ?? new URL("/callback", this.issuerUrl).href);

    tvUrl.searchParams.set("state", state);
    tvUrl.searchParams.set("display", "popup");
    res.redirect(tvUrl.toString());
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, code: string): Promise<string> {
    const pending = this.pendingCodes.get(code);
    if (!pending) throw new InvalidGrantError("Invalid or expired authorization code");
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    code: string,
    codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL
  ): Promise<OAuthTokens> {
    const pending = this.pendingCodes.get(code);
    if (!pending) throw new InvalidGrantError("Invalid or expired authorization code");

    if (!codeVerifier) throw new InvalidGrantError("code_verifier is required");
    const computed = createHash("sha256").update(codeVerifier).digest("base64url");
    if (computed !== pending.codeChallenge) throw new InvalidGrantError("Invalid code_verifier");

    this.pendingCodes.delete(code);

    const expiresIn = pending.expiresAt
      ? Math.max(0, Math.floor((pending.expiresAt - Date.now()) / 1000))
      : undefined;

    return {
      access_token: pending.accessToken,
      token_type: "Bearer",
      refresh_token: pending.refreshToken,
      expires_in: expiresIn,
      scope: pending.scope,
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    const body: Record<string, unknown> = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.tvClientId,
      client_secret: this.tvClientSecret,
    };
    if (scopes?.length) body.scope = scopes.join(" ");

    const resp = await fetch(TV_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[teamviewer-mcp] Token refresh failed:", resp.status, errBody);
      throw new InvalidGrantError("Token refresh failed. Please re-authenticate.");
    }

    const token = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (token.expires_in) {
      this.tokenExpiry.set(token.access_token, Math.floor(Date.now() / 1000) + token.expires_in);
    }

    return {
      access_token: token.access_token,
      token_type: "Bearer",
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      scope: token.scope,
    };
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const cached = this.tokenCache.get(accessToken);
    if (cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
      return cached.authInfo;
    }

    const resp = await fetch(TV_ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      this.tokenCache.delete(accessToken);
      throw new InvalidTokenError("Invalid or expired TeamViewer access token");
    }

    const info = await resp.json() as { userid?: string; email?: string; name?: string };

    // expiresAt is required by the bearer-auth middleware (epoch seconds).
    // Use the value stored when the token was issued; fall back to 1 hour from now.
    const expiresAt = this.tokenExpiry.get(accessToken) ?? Math.floor(Date.now() / 1000) + 3600;

    const authInfo: AuthInfo = {
      token: accessToken,
      clientId: this.tvClientId,
      scopes: [],
      expiresAt,
      extra: {
        userid: info.userid ?? "unknown",
        email: info.email ?? "unknown",
        name: info.name ?? "unknown",
      },
    };

    this.tokenCache.set(accessToken, { authInfo, cachedAt: Date.now() });
    return authInfo;
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.tokenCache.delete(request.token);
    await fetch(TV_REVOKE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${request.token}`, "Content-Type": "application/json" },
    }).catch(() => {
      // Ignore revocation errors — token may already be expired or revoked
    });
  }

  /**
   * Called by the GET /callback route when TeamViewer redirects the user back.
   * Exchanges the TV authorization code for TV tokens, issues an MCP auth code,
   * and returns the URL to redirect the user back to the MCP client (Claude).
   */
  async handleCallback(tvCode: string, state: string): Promise<string> {
    const pending = this.pendingAuths.get(state);
    if (!pending) throw new Error("Invalid or expired OAuth state parameter");
    this.pendingAuths.delete(state);

    const callbackUri = this.callbackUrl ?? new URL("/callback", this.issuerUrl).href;

    const resp = await fetch(TV_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: tvCode,
        redirect_uri: callbackUri,
        client_id: this.tvClientId,
        client_secret: this.tvClientSecret,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[teamviewer-mcp] Token exchange failed:", resp.status, errBody);
      throw new Error("Authorization failed. Please try again.");
    }

    const token = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (token.expires_in) {
      this.tokenExpiry.set(token.access_token, Math.floor(Date.now() / 1000) + token.expires_in);
    }

    // Issue an MCP authorization code that maps to the TV tokens
    const mcpCode = randomBytes(32).toString("hex");
    this.pendingCodes.set(mcpCode, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      scope: token.scope,
      codeChallenge: pending.codeChallenge,
    });

    const redirectUrl = new URL(pending.clientRedirectUri);
    redirectUrl.searchParams.set("code", mcpCode);
    redirectUrl.searchParams.set("state", state);
    return redirectUrl.toString();
  }
}
