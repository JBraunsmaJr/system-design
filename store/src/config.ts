/**
 * The store's configuration (WS8-R9).
 *
 * Everything comes from the environment, and anything unusable stops
 * startup with a sentence saying what to set. The alternative - starting
 * with a quiet default - is how a deployment ends up unauthenticated, or
 * keeping records for thirty days when it meant seven years.
 */
import { readFileSync } from "fs";
import { parseRetentionPeriod, describeRetention, type RetentionPeriod } from "./retention.ts";
import type { ProviderConfig } from "./auth/providers.ts";

export interface StoreConfig {
  port: number;
  databaseUrl: string | null;
  /** The store's own public address: where providers send people back to,
   * and what decides whether its cookie is marked Secure. */
  publicUrl: string;
  /** Origins the editor is served from (WS10-R1). */
  allowedOrigins: string[];
  providers: ProviderConfig[];
  /** `issuer#subject` for each administrator (WS10-R2). */
  admins: string[];
  retention: RetentionPeriod;
  cryptoMode: "webcrypto" | "passthrough";
  /**
   * The organization's recovery public key, PEM (WS7-R4, R10). Clients wrap
   * every document key to it, and the store refuses documents that arrive
   * without that wrap. Its private half is generated once at first-run
   * setup and kept offline; the store never holds it.
   */
  recoveryPublicKeyPem: string | null;
  maxBlobBytes: number;
  maxBlobsPerDocument: number;
  maxTotalBytes: number;
  /** How often the purge sweep runs (WS10-R4). */
  purgeIntervalMs: number;
  /** Development only: no sign-in at all. */
  allowUnauthenticated: boolean;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

const required = (env: Env, name: string, why: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is required: ${why}`);
  return value;
};

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const positive = (env: Env, name: string, fallback: number): number => {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new ConfigError(`${name} must be a positive number, not "${raw}".`);
  return value;
};

function url(name: string, value: string): string {
  try {
    return new URL(value).origin + new URL(value).pathname.replace(/\/+$/, "");
  } catch {
    throw new ConfigError(`${name} must be an absolute URL, not "${value}".`);
  }
}

export function loadStoreConfig(env: Env = process.env): StoreConfig {
  const allowUnauthenticated = env.ALLOW_UNAUTHENTICATED === "true";
  const publicUrl = url("PUBLIC_URL", required(env, "PUBLIC_URL", "the address people reach this store at, so sign-in can return to it."));
  const allowedOrigins = list(env.ALLOWED_ORIGINS).map((origin) => url("ALLOWED_ORIGINS", origin));

  const providers: ProviderConfig[] = [];
  for (const id of list(env.AUTH_PROVIDERS)) {
    if (id === "oidc") {
      providers.push({
        id,
        kind: "oidc",
        issuer: url("OIDC_ISSUER", required(env, "OIDC_ISSUER", "the identity provider's issuer URL, for example a Keycloak realm.")),
        // Where this server reaches the provider, when that differs from
        // where the browser does - a container network, usually.
        ...(env.OIDC_INTERNAL_URL?.trim() ? { internalUrl: url("OIDC_INTERNAL_URL", env.OIDC_INTERNAL_URL.trim()) } : {}),
        clientId: required(env, "OIDC_CLIENT_ID", "the client this store is registered as."),
        clientSecret: required(env, "OIDC_CLIENT_SECRET", "the client secret; it stays on the server."),
        scopes: list(env.OIDC_SCOPES).length ? list(env.OIDC_SCOPES) : undefined,
      });
    } else if (id === "github") {
      providers.push({
        id,
        kind: "github",
        clientId: required(env, "GITHUB_CLIENT_ID", "the GitHub OAuth app's client id."),
        clientSecret: required(env, "GITHUB_CLIENT_SECRET", "the GitHub OAuth app's client secret."),
        ...(env.GITHUB_AUTHORIZE_URL ? { authorizeUrl: env.GITHUB_AUTHORIZE_URL } : {}),
        ...(env.GITHUB_TOKEN_URL ? { tokenUrl: env.GITHUB_TOKEN_URL } : {}),
        ...(env.GITHUB_USER_URL ? { userUrl: env.GITHUB_USER_URL } : {}),
      });
    } else {
      throw new ConfigError(`AUTH_PROVIDERS names an unknown provider "${id}". Supported: oidc, github.`);
    }
  }

  if (providers.length === 0 && !allowUnauthenticated) {
    throw new ConfigError(
      "No sign-in is configured. Set AUTH_PROVIDERS (oidc and/or github), or ALLOW_UNAUTHENTICATED=true for development only - a store with neither would be open to anyone who can reach it.",
    );
  }

  // Secure cookies only travel over HTTPS, and a cross-origin editor needs
  // SameSite=None, which requires Secure. Browsers make an exception for
  // localhost, which is what lets development work over plain HTTP.
  const localOnly = (value: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(value);
  const crossOrigin = allowedOrigins.some((origin) => origin !== new URL(publicUrl).origin);
  if (crossOrigin && !publicUrl.startsWith("https://") && !localOnly(publicUrl)) {
    throw new ConfigError(
      `The editor at ${allowedOrigins.join(", ")} is on a different origin from this store (${publicUrl}), which needs a SameSite=None cookie, which browsers only accept over HTTPS. Serve the store over HTTPS, or put both behind one origin.`,
    );
  }

  const recoveryPublicKeyPem = (() => {
    const inline = env.RECOVERY_PUBLIC_KEY?.trim();
    const path = env.RECOVERY_PUBLIC_KEY_FILE?.trim();
    if (inline && path) throw new ConfigError("Set RECOVERY_PUBLIC_KEY or RECOVERY_PUBLIC_KEY_FILE, not both.");
    const pem = inline ?? (path ? readFileSync(path, "utf8") : "");
    if (!pem.trim()) return null;
    if (!/-----BEGIN PUBLIC KEY-----/.test(pem)) {
      throw new ConfigError(
        `The recovery key does not look like a PEM public key. It must be the PUBLIC half - the private half is kept offline and never given to the store (WS7-R5). Generate a pair with: npx tsx scripts/generate-recovery-key.ts`,
      );
    }
    return pem.trim();
  })();

  const cryptoMode = (env.CRYPTO_MODE ?? "webcrypto").trim();
  if (cryptoMode !== "webcrypto" && cryptoMode !== "passthrough") {
    throw new ConfigError(`CRYPTO_MODE must be "webcrypto" or "passthrough", not "${cryptoMode}".`);
  }

  return {
    port: positive(env, "PORT", 8080),
    databaseUrl: env.DATABASE_URL?.trim() || null,
    publicUrl,
    allowedOrigins,
    providers,
    admins: list(env.ADMIN_SUBJECTS),
    retention: parseRetentionPeriod(env.RETENTION_PERIOD),
    cryptoMode,
    recoveryPublicKeyPem,
    maxBlobBytes: positive(env, "MAX_BLOB_BYTES", 8 * 1024 * 1024),
    maxBlobsPerDocument: positive(env, "MAX_BLOBS_PER_DOCUMENT", 100_000),
    maxTotalBytes: positive(env, "MAX_TOTAL_BYTES", Number.POSITIVE_INFINITY),
    purgeIntervalMs: positive(env, "PURGE_INTERVAL_MINUTES", 60) * 60_000,
    allowUnauthenticated,
  };
}

/** What the store prints at startup, so an operator can see what it is. */
export function describeConfig(config: StoreConfig): string[] {
  return [
    `Listening on port ${config.port}, public address ${config.publicUrl}`,
    config.databaseUrl ? "Storage: PostgreSQL" : "Storage: in memory (nothing is kept when this process stops)",
    config.providers.length
      ? `Sign-in: ${config.providers
          .map((p) => `${p.id}${p.issuer ? ` at ${p.issuer}` : ""}${p.internalUrl ? ` (reached here as ${p.internalUrl})` : ""}`)
          .join(", ")}`
      : "Sign-in: NONE - this store is open to anyone who can reach it",
    config.allowedOrigins.length ? `Editor origins: ${config.allowedOrigins.join(", ")}` : "Editor origins: same origin only",
    config.admins.length ? `Administrators: ${config.admins.length}` : "Administrators: none configured - holds and purges are refused to everyone",
    describeRetention(config.retention),
    config.cryptoMode === "passthrough"
      ? "Crypto mode: PASSTHROUGH - documents are stored unencrypted and this server can read them"
      : "Crypto mode: webcrypto - documents arrive sealed and this server cannot read them",
    config.cryptoMode === "passthrough"
      ? "Recovery escrow: not applicable in passthrough mode"
      : config.recoveryPublicKeyPem
        ? "Recovery escrow: configured - every document is also recoverable with the organization's offline key"
        : "Recovery escrow: NOT CONFIGURED - documents will be refused (WS7-R4). Set RECOVERY_PUBLIC_KEY_FILE.",
  ];
}
