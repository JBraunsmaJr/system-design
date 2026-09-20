/** WS8-R9: the store's configuration, and what it refuses to start with. */
import { ConfigError, describeConfig, loadStoreConfig } from "./config.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
function refuses(env: Record<string, string | undefined>, expect: RegExp, message: string) {
  try {
    loadStoreConfig(env);
    failures++;
    console.error(`  FAIL: ${message} (it started)`);
  } catch (error) {
    const text = error instanceof ConfigError ? error.message : `other: ${String(error)}`;
    if (!expect.test(text)) {
      failures++;
      console.error(`  FAIL: ${message} (message was: ${text})`);
    } else console.log(`  ✓ ${message}`);
  }
}

const WORKING = {
  PUBLIC_URL: "https://store.example.gov",
  ALLOWED_ORIGINS: "https://design.example.gov",
  AUTH_PROVIDERS: "oidc",
  OIDC_ISSUER: "https://keycloak.example.gov/realms/design",
  OIDC_CLIENT_ID: "system-design-store",
  OIDC_CLIENT_SECRET: "secret",
  DATABASE_URL: "postgresql://store@db/store",
};

console.log("=== A working configuration ===");
{
  const config = loadStoreConfig(WORKING);
  assert(config.port === 8080 && config.publicUrl === "https://store.example.gov", "defaults where nothing is set");
  assert(config.providers[0]?.kind === "oidc" && (config.providers[0].issuer ?? "").includes("keycloak"), "the identity provider is configured");
  assert(config.retention.kind === "duration", "retention defaults to a duration (30d)");
  assert(config.cryptoMode === "webcrypto", "and encryption is on by default");
  const described = describeConfig(config).join("\n");
  assert(/PostgreSQL/.test(described) && /keycloak|oidc/i.test(described), "startup prints what it is");
  assert(/Administrators: none configured/.test(described), "including that no administrator is configured");
}

console.log("\n=== Where people land after signing in ===");
{
  const config = loadStoreConfig(WORKING);
  assert(config.afterLoginUrl === "https://design.example.gov", "by default, the editor - not the store's own root");
  assert(
    loadStoreConfig({ ...WORKING, AFTER_LOGIN_URL: "https://design.example.gov/system-design/" }).afterLoginUrl.startsWith("https://design.example.gov"),
    "a path within the editor can be set"
  );
  assert(
    loadStoreConfig({ ...WORKING, ALLOWED_ORIGINS: "" }).afterLoginUrl === "https://store.example.gov",
    "with no editor origin, the store's own address"
  );
}

console.log("\n=== What it refuses ===");
refuses({ ...WORKING, PUBLIC_URL: undefined }, /PUBLIC_URL is required/, "no public address");
refuses({ ...WORKING, PUBLIC_URL: "store.example.gov" }, /absolute URL/, "a public address that is not a URL");
refuses({ ...WORKING, AUTH_PROVIDERS: "" }, /No sign-in is configured/, "no sign-in, unless development is declared");
refuses({ ...WORKING, AUTH_PROVIDERS: "saml" }, /unknown provider/, "a provider it does not support");
refuses({ ...WORKING, OIDC_CLIENT_SECRET: undefined }, /OIDC_CLIENT_SECRET is required/, "an identity provider with no secret");
refuses({ ...WORKING, AUTH_PROVIDERS: "github", GITHUB_CLIENT_ID: undefined }, /GITHUB_CLIENT_ID is required/, "GitHub with no client id");
refuses({ ...WORKING, RETENTION_PERIOD: "thirty days" }, /Unrecognised retention period/, "a retention period it cannot parse");
refuses({ ...WORKING, CRYPTO_MODE: "aes" }, /CRYPTO_MODE must be/, "an unknown crypto mode");
refuses({ ...WORKING, MAX_BLOB_BYTES: "-1" }, /must be a positive number/, "a negative limit");
refuses(
  { ...WORKING, AFTER_LOGIN_URL: "https://elsewhere.example.com/" },
  /open redirect/,
  "sending people somewhere untrusted after they sign in"
);
// The one that would look fine and then fail in the browser: a cross-origin
// editor needs SameSite=None, which needs HTTPS.
refuses(
  { ...WORKING, PUBLIC_URL: "http://store.example.gov", ALLOWED_ORIGINS: "http://design.example.gov" },
  /HTTPS/,
  "a cross-origin editor over plain HTTP, whose cookies a browser would silently drop"
);

console.log("\n=== Development ===");
{
  const dev = loadStoreConfig({ PUBLIC_URL: "http://localhost:8080", ALLOW_UNAUTHENTICATED: "true" });
  assert(dev.allowUnauthenticated && dev.providers.length === 0, "no sign-in is allowed when declared explicitly");
  assert(/Sign-in: NONE/.test(describeConfig(dev).join("\n")), "and startup says so in as many words");
  const local = loadStoreConfig({ ...WORKING, PUBLIC_URL: "http://localhost:8080", ALLOWED_ORIGINS: "http://localhost:5173" });
  assert(local.allowedOrigins.length === 1, "localhost over plain HTTP is allowed, because browsers treat it as secure");
}

console.log("\n=== Retention and limits ===");
{
  const strict = loadStoreConfig({ ...WORKING, RETENTION_PERIOD: "7y", CRYPTO_MODE: "passthrough", ADMIN_SUBJECTS: "https://idp#alice, https://idp#bob" });
  assert(strict.retention.kind === "duration" && strict.admins.length === 2, "a records schedule and administrators are read");
  assert(/PASSTHROUGH/.test(describeConfig(strict).join("\n")), "and passthrough is announced loudly");
  assert(loadStoreConfig({ ...WORKING, RETENTION_PERIOD: "immediate" }).retention.kind === "immediate", "immediate deletion is configurable");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll store configuration checks passed.");
}
