/**
 * The deployment example, checked for the mistakes that only appear when
 * someone runs it (WS8-R9, WS10-R1).
 *
 * The compose file, the Keycloak realm it imports, and the store's own
 * configuration rules have to agree. They are three files that drift
 * silently: a redirect URI that no longer matches PUBLIC_URL fails at the
 * provider, before the store is involved, and a client secret that does
 * not match fails at the token exchange with an error that says little.
 */
import { readFileSync } from "fs";
import { loadStoreConfig, ConfigError } from "../store/src/config.ts";

/**
 * Enough YAML for this one file, rather than a dependency the store would
 * then carry: the example is a flat map of services, each with a plain
 * `environment` map and a list of `volumes`. Anything more elaborate here
 * should be simplified in the example, not parsed harder.
 */
function readComposeExample(text: string) {
  const services: Record<string, { environment: Record<string, string>; volumes: string[]; command?: string; dependsOn: string[] }> = {};
  let service: string | null = null;
  let section: "environment" | "volumes" | "depends_on" | null = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 2 && line.endsWith(":")) {
      service = line.slice(0, -1);
      services[service] = { environment: {}, volumes: [], dependsOn: [] };
      section = null;
      continue;
    }
    if (!service) continue;
    if (indent === 4) {
      section = line === "environment:" ? "environment" : line === "volumes:" ? "volumes" : line === "depends_on:" ? "depends_on" : null;
      if (line.startsWith("command:")) services[service].command = line.slice("command:".length).trim();
      continue;
    }
    if (indent >= 6 && section === "environment") {
      const at = line.indexOf(":");
      if (at > 0) services[service].environment[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    } else if (indent >= 6 && section === "volumes" && line.startsWith("- ")) {
      services[service].volumes.push(line.slice(2).trim());
    } else if (indent === 6 && section === "depends_on" && line.endsWith(":")) {
      services[service].dependsOn.push(line.slice(0, -1));
    }
  }
  return { services };
}

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const compose = readComposeExample(readFileSync("docker/store/compose.example.yaml", "utf8"));
const realm = JSON.parse(readFileSync("docker/store/keycloak/system-design-realm.json", "utf8")) as {
  realm: string;
  clients: { clientId: string; secret: string; redirectUris: string[]; webOrigins: string[]; publicClient: boolean }[];
  users: { username: string; email?: string; requiredActions?: string[] }[];
};

const store = compose.services.store.environment;
const editor = compose.services.editor.environment;
const client = realm.clients[0];

console.log("=== The store's own settings are valid ===");
{
  // The same validation the store applies at startup, so the example
  // cannot ship a configuration the store would refuse.
  try {
    const config = loadStoreConfig({ ...store, RECOVERY_PUBLIC_KEY_FILE: undefined, RECOVERY_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----" });
    check(config.providers[0]?.id === "oidc", "the example configures sign-in");
    check(config.allowedOrigins.length > 0, "and names the editor's origin");
  } catch (error) {
    check(false, `the store would start with these settings (${error instanceof ConfigError ? error.message : String(error)})`);
  }
}

console.log("\n=== The example agrees with itself ===");
check(store.OIDC_ISSUER?.endsWith(`/realms/${realm.realm}`), `the store points at the realm the example imports (${store.OIDC_ISSUER})`);
check(store.OIDC_CLIENT_ID === client.clientId, "and at the client the realm registers");
check(store.OIDC_CLIENT_SECRET === client.secret, "with the same client secret on both sides");
check(
  client.redirectUris.includes(`${store.PUBLIC_URL}/v1/auth/callback`),
  `the realm's redirect URI is exactly the store's callback (${client.redirectUris.join(", ")})`
);
check(client.webOrigins.includes(editor.APP_URL) || client.webOrigins.includes("+"), "and the editor's origin is allowed");
check(store.ALLOWED_ORIGINS === editor.APP_URL, `the store allows the editor's origin (${store.ALLOWED_ORIGINS})`);
check(editor.STORE_URL === store.PUBLIC_URL, "and the editor points at the store's public address");
check(!client.publicClient, "the store is a confidential client: the secret stays on the server");
// The mistake this example made until someone ran it: one address for a
// provider the browser and the store reach differently.
const keycloak = compose.services.keycloak.environment;
check(
  !!store.OIDC_INTERNAL_URL && !/localhost|127\.0\.0\.1/.test(store.OIDC_INTERNAL_URL),
  `the store reaches the provider by service name, not localhost (${store.OIDC_INTERNAL_URL ?? "not set"})`
);
check(
  /localhost|127\.0\.0\.1/.test(store.OIDC_ISSUER ?? ""),
  "while the browser is sent to the address it can actually reach"
);
check(
  keycloak.KC_HOSTNAME === new URL(store.OIDC_ISSUER!).origin,
  `and the provider knows its own public address (KC_HOSTNAME ${keycloak.KC_HOSTNAME ?? "not set"})`
);

console.log("\n=== Things that must not reach a real deployment ===");
check(
  (compose.services.keycloak.command ?? "").includes("--import-realm"),
  "Keycloak is told to import the realm, or the store would point at one that does not exist"
);
check(compose.services.store.dependsOn.includes("keycloak") && compose.services.store.dependsOn.includes("postgres"), `the store waits for its dependencies (${compose.services.store.dependsOn.join(", ")})`);
check(
  compose.services.store.volumes.some((volume) => volume.includes("recovery-public.pem")),
  "the recovery public key is mounted, or the store would refuse every document (WS7-R4)"
);
check(
  compose.services.store.volumes.every((volume) => !volume.includes("private")),
  "and the private half is nowhere near the store"
);
for (const user of realm.users ?? []) {
  check(!!user.email, `the demo user has an email, or Keycloak will not finish its sign-in (${user.username})`);
  check((user.requiredActions ?? []).length === 0, `and nothing it must do first (${user.username})`);
}
const ignored = readFileSync(".gitignore", "utf8");
check(/-private\.pem/.test(ignored), "a private recovery key cannot be committed by accident");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll deployment example checks passed.");
