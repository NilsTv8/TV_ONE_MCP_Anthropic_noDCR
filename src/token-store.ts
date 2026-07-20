import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from "crypto";
import { InvalidTokenError, InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const MCP_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const MCP_REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly maxSize: number) { super(); }
  set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.maxSize) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    return super.set(key, value);
  }
}

/** AES-256-GCM encrypt; output is base64(iv || ciphertext || authTag). */
function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
}

/** Inverse of encrypt(). Throws if the ciphertext/authTag don't verify. */
function decrypt(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface TvGrant {
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

export interface McpAccessMeta {
  subject: string;
  aud: string;
  scopes: string[];
  expiresAt: number;
}

interface McpRefreshMeta {
  subject: string;
  aud: string;
  scopes: string[];
  expiresAt: number;
  rotationId: string;
  used: boolean;
}

export interface IssuedMcpTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Server-side custody of TeamViewer tokens plus bookkeeping for the MCP's own
 * (opaque, locally-verifiable) access/refresh tokens. TeamViewer secrets are
 * encrypted at rest; MCP tokens are looked up by SHA-256 hash so a store dump
 * never yields a usable bearer.
 */
export class TokenStore {
  private readonly tvGrants = new BoundedMap<string, TvGrant>(10000);
  private readonly mcpAccessTokens = new BoundedMap<string, McpAccessMeta>(10000);
  private readonly mcpRefreshTokens = new BoundedMap<string, McpRefreshMeta>(10000);

  constructor(private readonly encryptionKey: Buffer) {}

  saveTvGrant(
    subject: string,
    grant: { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }
  ): void {
    this.tvGrants.set(subject, {
      encryptedAccessToken: encrypt(grant.accessToken, this.encryptionKey),
      encryptedRefreshToken: grant.refreshToken ? encrypt(grant.refreshToken, this.encryptionKey) : undefined,
      expiresAt: grant.expiresAt,
      scope: grant.scope,
    });
  }

  getTvGrant(subject: string): { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string } | undefined {
    const grant = this.tvGrants.get(subject);
    if (!grant) return undefined;
    return {
      accessToken: decrypt(grant.encryptedAccessToken, this.encryptionKey),
      refreshToken: grant.encryptedRefreshToken ? decrypt(grant.encryptedRefreshToken, this.encryptionKey) : undefined,
      expiresAt: grant.expiresAt,
      scope: grant.scope,
    };
  }

  deleteTvGrant(subject: string): void {
    this.tvGrants.delete(subject);
  }

  issueMcpTokens(subject: string, scopes: string[], aud: string, rotationId?: string): IssuedMcpTokens {
    const now = Date.now();
    const accessToken = randomBytes(32).toString("hex");
    const refreshToken = randomBytes(32).toString("hex");
    const chainId = rotationId ?? randomUUID();

    this.mcpAccessTokens.set(hashToken(accessToken), {
      subject,
      aud,
      scopes,
      expiresAt: now + MCP_ACCESS_TOKEN_TTL_MS,
    });
    this.mcpRefreshTokens.set(hashToken(refreshToken), {
      subject,
      aud,
      scopes,
      expiresAt: now + MCP_REFRESH_TOKEN_TTL_MS,
      rotationId: chainId,
      used: false,
    });

    return { accessToken, refreshToken, expiresIn: Math.floor(MCP_ACCESS_TOKEN_TTL_MS / 1000) };
  }

  verifyMcpAccessToken(token: string): McpAccessMeta {
    const meta = this.mcpAccessTokens.get(hashToken(token));
    if (!meta || meta.expiresAt < Date.now()) {
      throw new InvalidTokenError("Invalid or expired access token");
    }
    return meta;
  }

  rotateMcpRefreshToken(token: string): IssuedMcpTokens & { subject: string; scopes: string[] } {
    const key = hashToken(token);
    const meta = this.mcpRefreshTokens.get(key);

    if (!meta || meta.expiresAt < Date.now()) {
      throw new InvalidGrantError("Invalid or expired refresh token");
    }

    if (meta.used) {
      // Reuse of a consumed refresh token — revoke every MCP token for this
      // subject (a subject has at most one active rotation chain here).
      this.revokeMcpTokens(meta.subject);
      throw new InvalidGrantError("Refresh token reuse detected; session revoked");
    }

    meta.used = true;
    const issued = this.issueMcpTokens(meta.subject, meta.scopes, meta.aud, meta.rotationId);
    return { ...issued, subject: meta.subject, scopes: meta.scopes };
  }

  private revokeMcpTokens(subject: string): void {
    for (const [key, meta] of this.mcpAccessTokens) {
      if (meta.subject === subject) this.mcpAccessTokens.delete(key);
    }
    for (const [key, meta] of this.mcpRefreshTokens) {
      if (meta.subject === subject) this.mcpRefreshTokens.delete(key);
    }
  }

  revokeSubject(subject: string): void {
    this.deleteTvGrant(subject);
    this.revokeMcpTokens(subject);
  }

  subjectForToken(token: string): string | undefined {
    return this.mcpAccessTokens.get(hashToken(token))?.subject;
  }
}

export function loadEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("TEAMVIEWER_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)");
  }
  return key;
}
