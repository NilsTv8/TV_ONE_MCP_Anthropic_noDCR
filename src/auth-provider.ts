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
  InvalidGrantError,
  InvalidTargetError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { BoundedMap, TokenStore } from "./token-store.js";

const TV_AUTHORIZE_URL = "https://account.teamviewer.com/oauth2/authorize";
const TV_TOKEN_URL = "https://webapi.teamviewer.com/api/v1/OAuth2/token";
const TV_REVOKE_URL = "https://webapi.teamviewer.com/api/v1/OAuth2/revoke";
const TV_ACCOUNT_URL = "https://webapi.teamviewer.com/api/v1/account";

// TV access tokens are refreshed this far ahead of their real expiry so a
// brokered call never races a token that's about to die mid-request.
const TV_REFRESH_BUFFER_MS = 2 * 60 * 1000;

interface PendingAuth {
  clientRedirectUri: string;
  codeChallenge: string;
  scopes?: string[];
  resource?: string;
}

interface PendingCode {
  subject: string;
  scope?: string;
  codeChallenge: string;
}

interface TvTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * OAuth provider that brokers the authorization flow to TeamViewer, for MCP
 * clients that don't support Dynamic Client Registration (e.g. Copilot
 * Studio). Any client_id is accepted (capture-redirect-uri pattern) — see
 * recordRedirectUri()/knownRedirectUris below.
 *
 * TeamViewer uses a non-standard token exchange format (JSON body with numeric grant_type),
 * so we cannot use the SDK's ProxyOAuthServerProvider. Instead:
 *  - authorize() redirects to TeamViewer with OUR client credentials and a /callback redirect_uri
 *  - handleCallback() is called by the /callback Express route; it exchanges the TV code,
 *    stores the TV tokens server-side (encrypted, keyed by TV userid), and issues our own
 *    MCP authorization code that references the subject — never the TV tokens.
 *  - exchangeAuthorizationCode()/exchangeRefreshToken() mint the MCP's own opaque,
 *    locally-verifiable tokens (aud = this MCP server). The client never sees a TV token.
 *  - verifyAccessToken() validates MCP tokens locally (no network call to TeamViewer).
 *  - resolveTeamViewerToken() is the only place a real TV token is produced, for
 *    server-side use when actually calling the TeamViewer WebAPI on the client's behalf.
 */
export class TeamViewerOAuthProvider implements OAuthServerProvider {
  readonly skipLocalPkceValidation = true;

  private readonly pendingAuths = new BoundedMap<string, PendingAuth>(1000);
  private readonly pendingCodes = new BoundedMap<string, PendingCode>(1000);
  private readonly knownRedirectUris = new BoundedMap<string, string>(1000);

  constructor(
    private readonly tvClientId: string,
    private readonly tvClientSecret: string,
    private readonly issuerUrl: URL,
    private readonly resourceUri: string,
    private readonly tokenStore: TokenStore,
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
    if (params.resource && params.resource.href !== this.resourceUri) {
      throw new InvalidTargetError(`resource must be ${this.resourceUri}`);
    }

    const state = params.state ?? randomBytes(16).toString("hex");

    this.pendingAuths.set(state, {
      clientRedirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes,
      resource: params.resource?.href,
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
    resource?: URL
  ): Promise<OAuthTokens> {
    const pending = this.pendingCodes.get(code);
    if (!pending) throw new InvalidGrantError("Invalid or expired authorization code");

    if (!codeVerifier) throw new InvalidGrantError("code_verifier is required");
    const computed = createHash("sha256").update(codeVerifier).digest("base64url");
    if (computed !== pending.codeChallenge) throw new InvalidGrantError("Invalid code_verifier");

    if (resource && resource.href !== this.resourceUri) {
      throw new InvalidTargetError(`resource must be ${this.resourceUri}`);
    }

    this.pendingCodes.delete(code);

    const scopes = pending.scope ? pending.scope.split(" ") : [];
    const issued = this.tokenStore.issueMcpTokens(pending.subject, scopes, this.resourceUri);

    return {
      access_token: issued.accessToken,
      token_type: "Bearer",
      refresh_token: issued.refreshToken,
      expires_in: issued.expiresIn,
      scope: pending.scope,
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    if (resource && resource.href !== this.resourceUri) {
      throw new InvalidTargetError(`resource must be ${this.resourceUri}`);
    }

    const issued = this.tokenStore.rotateMcpRefreshToken(refreshToken);

    return {
      access_token: issued.accessToken,
      token_type: "Bearer",
      refresh_token: issued.refreshToken,
      expires_in: issued.expiresIn,
      scope: issued.scopes.join(" "),
    };
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const meta = this.tokenStore.verifyMcpAccessToken(accessToken);

    return {
      token: accessToken,
      clientId: this.tvClientId,
      scopes: meta.scopes,
      expiresAt: Math.floor(meta.expiresAt / 1000),
      extra: { subject: meta.subject },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const subject = this.tokenStore.subjectForToken(request.token);
    if (!subject) return;

    try {
      const tvToken = await this.resolveTeamViewerToken(subject);
      await fetch(TV_REVOKE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${tvToken}`, "Content-Type": "application/json" },
      });
    } catch {
      // Best-effort — TV grant may already be gone or expired.
    }

    this.tokenStore.revokeSubject(subject);
  }

  /**
   * Resolves the TeamViewer access token for a subject, refreshing it via
   * TeamViewer if it's near expiry. This is the only path that ever produces
   * a real TV token — used server-side to call the TeamViewer WebAPI on the
   * client's behalf; the MCP client never sees it.
   */
  async resolveTeamViewerToken(subject: string): Promise<string> {
    const grant = this.tokenStore.getTvGrant(subject);
    if (!grant) throw new Error("No TeamViewer grant for this session. Please re-authenticate.");

    if (!grant.expiresAt || grant.expiresAt - Date.now() > TV_REFRESH_BUFFER_MS) {
      return grant.accessToken;
    }

    if (!grant.refreshToken) return grant.accessToken;

    const resp = await fetch(TV_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: grant.refreshToken,
        client_id: this.tvClientId,
        client_secret: this.tvClientSecret,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[teamviewer-mcp] TV token refresh failed:", resp.status, errBody);
      throw new Error("TeamViewer session expired. Please re-authenticate.");
    }

    const token = await resp.json() as TvTokenResponse;
    this.tokenStore.saveTvGrant(subject, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? grant.refreshToken,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      scope: token.scope ?? grant.scope,
    });

    return token.access_token;
  }

  /**
   * Called by the GET /callback route when TeamViewer redirects the user back.
   * Exchanges the TV authorization code for TV tokens, stores them server-side
   * keyed by the TV subject, and issues an MCP auth code that references that
   * subject — never the TV tokens themselves.
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

    const token = await resp.json() as TvTokenResponse;

    const accountResp = await fetch(TV_ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!accountResp.ok) {
      throw new Error("Failed to resolve TeamViewer account for this session.");
    }
    const account = await accountResp.json() as { userid?: string };
    const subject = account.userid;
    if (!subject) throw new Error("TeamViewer account response missing userid.");

    this.tokenStore.saveTvGrant(subject, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      scope: token.scope,
    });

    const mcpCode = randomBytes(32).toString("hex");
    this.pendingCodes.set(mcpCode, {
      subject,
      scope: token.scope,
      codeChallenge: pending.codeChallenge,
    });

    const redirectUrl = new URL(pending.clientRedirectUri);
    redirectUrl.searchParams.set("code", mcpCode);
    redirectUrl.searchParams.set("state", state);
    return redirectUrl.toString();
  }
}
