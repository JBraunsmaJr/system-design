/**
 * The deployment examples, checked for the mistakes that only appear when
 * someone runs them.
 *
 * The compose file, the Keycloak realm it imports, and the store's own
 * configuration rules have to agree. They are three files that drift
 * silently: a redirect URI that no longer matches PUBLIC_URL fails at the
 * provider, before the store is involved, and a client secret that does
 * not match fails at the token exchange with an error that says little.
 */
import { readFileSync, existsSync } from 'fs';
import { loadStoreConfig, ConfigError } from '../store/src/config.ts';

/**
 * Enough YAML for this one file, rather than a dependency the store would
 * then carry: the example is a flat map of services, each with a plain
 * `environment` map and a list of `volumes`. Anything more elaborate here
 * should be simplified in the example, not parsed harder.
 */
function readComposeExample(text: string) {
  const services: Record<
    string,
    {
      environment: Record<string, string>;
      volumes: string[];
      command?: string;
      dependsOn: string[];
    }
  > = {};
  let service: string | null = null;
  let section: 'environment' | 'volumes' | 'depends_on' | null = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 2 && line.endsWith(':')) {
      service = line.slice(0, -1);
      services[service] = { environment: {}, volumes: [], dependsOn: [] };
      section = null;
      continue;
    }
    if (!service) continue;
    if (indent === 4) {
      section =
        line === 'environment:'
          ? 'environment'
          : line === 'volumes:'
            ? 'volumes'
            : line === 'depends_on:'
              ? 'depends_on'
              : null;
      if (line.startsWith('command:'))
        services[service].command = line.slice('command:'.length).trim();
      continue;
    }
    if (indent >= 6 && section === 'environment') {
      const at = line.indexOf(':');
      if (at > 0)
        services[service].environment[line.slice(0, at).trim()] = line
          .slice(at + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
    } else if (indent >= 6 && section === 'volumes' && line.startsWith('- ')) {
      services[service].volumes.push(line.slice(2).trim());
    } else if (indent === 6 && section === 'depends_on' && line.endsWith(':')) {
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

const composePath = existsSync('docker/store/compose.yaml')
  ? 'docker/store/compose.yaml'
  : 'docker/store/compose.example.yaml';
const compose = readComposeExample(readFileSync(composePath, 'utf8'));
const realm = JSON.parse(
  readFileSync('docker/store/keycloak/system-design-realm.json', 'utf8'),
) as {
  realm: string;
  clients: {
    clientId: string;
    secret: string;
    redirectUris: string[];
    webOrigins: string[];
    publicClient: boolean;
  }[];
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
    const config = loadStoreConfig(store);
    check(config.providers[0]?.id === 'oidc', 'the example configures sign-in');
    check(config.allowedOrigins.length > 0, "and names the editor's origin");
    check(
      config.retiredSettings.length === 0,
      `and sets nothing the store no longer reads (${config.retiredSettings.join(', ') || 'none'})`,
    );
  } catch (error) {
    check(
      false,
      `the store would start with these settings (${error instanceof ConfigError ? error.message : String(error)})`,
    );
  }
}

console.log('\n=== The example agrees with itself ===');
check(
  store.OIDC_ISSUER?.endsWith(`/realms/${realm.realm}`),
  `the store points at the realm the example imports (${store.OIDC_ISSUER})`,
);
check(store.OIDC_CLIENT_ID === client.clientId, 'and at the client the realm registers');
check(store.OIDC_CLIENT_SECRET === client.secret, 'with the same client secret on both sides');
check(
  client.redirectUris.includes(`${store.PUBLIC_URL}/v1/auth/callback`),
  `the realm's redirect URI is exactly the store's callback (${client.redirectUris.join(', ')})`,
);
check(
  client.webOrigins.includes(editor.APP_URL) || client.webOrigins.includes('+'),
  "and the editor's origin is allowed",
);
check(
  store.ALLOWED_ORIGINS === editor.APP_URL,
  `the store allows the editor's origin (${store.ALLOWED_ORIGINS})`,
);
check(editor.STORE_URL === store.PUBLIC_URL, "and the editor points at the store's public address");
check(
  store.AFTER_LOGIN_URL === editor.APP_URL,
  `signing in returns people to the editor, not the store's root (${store.AFTER_LOGIN_URL ?? 'not set'})`,
);
check(!client.publicClient, 'the store is a confidential client: the secret stays on the server');
// The mistake this example made until someone ran it: one address for a
// provider the browser and the store reach differently.
const keycloak = compose.services.keycloak.environment;
check(
  !!store.OIDC_INTERNAL_URL && !/localhost|127\.0\.0\.1/.test(store.OIDC_INTERNAL_URL),
  `the store reaches the provider by service name, not localhost (${store.OIDC_INTERNAL_URL ?? 'not set'})`,
);
check(
  /localhost|127\.0\.0\.1/.test(store.OIDC_ISSUER ?? ''),
  'while the browser is sent to the address it can actually reach',
);
check(
  keycloak.KC_HOSTNAME === new URL(store.OIDC_ISSUER!).origin,
  `and the provider knows its own public address (KC_HOSTNAME ${keycloak.KC_HOSTNAME ?? 'not set'})`,
);

console.log('\n=== Things that must not reach a real deployment ===');
check(
  (compose.services.keycloak.command ?? '').includes('--import-realm'),
  'Keycloak is told to import the realm, or the store would point at one that does not exist',
);
check(
  compose.services.store.dependsOn.includes('keycloak') &&
    compose.services.store.dependsOn.includes('postgres'),
  `the store waits for its dependencies (${compose.services.store.dependsOn.join(', ')})`,
);
check(
  compose.services.store.volumes.every((volume) => !/recovery|\.pem/.test(volume)),
  'the store mounts no key files: it has none to read',
);
for (const user of realm.users ?? []) {
  check(
    !!user.email,
    `the demo user has an email, or Keycloak will not finish its sign-in (${user.username})`,
  );
  check(
    (user.requiredActions ?? []).length === 0,
    `and nothing it must do first (${user.username})`,
  );
}

console.log('\n=== Someone can use it once it is up ===');
{
  // With nobody able to create a workspace the example starts, signs
  // people in, and then offers them nothing to do.
  const groupsMapper = (
    realm.clients[0] as unknown as {
      protocolMappers?: { protocolMapper: string; config: Record<string, string> }[];
    }
  ).protocolMappers?.find((mapper) => mapper.protocolMapper === 'oidc-group-membership-mapper');
  check(
    groupsMapper?.config['claim.name'] === (store.OIDC_GROUPS_CLAIM ?? 'groups') &&
      groupsMapper?.config['id.token.claim'] === 'true',
    'the realm puts groups in the ID token, under the claim the store reads',
  );
  const fullPath = groupsMapper?.config['full.path'] === 'true';
  const asInToken = (path: string) => (fullPath ? path : path.replace(/^.*\//, ''));
  const adminGroups = (store.ADMIN_GROUPS ?? '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);
  const realmGroups = ((realm as unknown as { groups?: { name: string }[] }).groups ?? []).map(
    (group) => asInToken(`/${group.name}`),
  );
  check(
    adminGroups.length > 0 && adminGroups.every((group) => realmGroups.includes(group)),
    `the administrators' group exists in the realm, spelled as the token will carry it (${adminGroups.join(', ') || 'none set'})`,
  );
  const admins = (realm.users ?? []).filter((user) =>
    ((user as unknown as { groups?: string[] }).groups ?? []).some((group) =>
      adminGroups.includes(asInToken(group)),
    ),
  );
  check(
    admins.length > 0,
    `and at least one account is in it, so a workspace can be created (${admins.map((user) => user.username).join(', ') || 'nobody'})`,
  );
}

console.log('\n=== The published example (docs-site/docs/files/workspace) ===');
{
  const published = readComposeExample(
    readFileSync('docs-site/docs/files/workspace/compose.yml', 'utf8'),
  );
  const env = readFileSync('docs-site/docs/files/workspace/workspace.env', 'utf8');
  const defaults: Record<string, string> = {
    DOMAIN: 'design.example.gov',
    POSTGRES_PASSWORD: 'p'.repeat(64),
    RELAY_TOKEN_SECRET: 'r'.repeat(64),
    OIDC_CLIENT_SECRET: 's'.repeat(64),
  };
  for (const line of env.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match && match[2] !== '') defaults[match[1]] = match[2];
  }
  // ${NAME}, ${NAME:-fallback} and ${NAME:?message}, as Compose reads them.
  const resolve = (value: string) =>
    value.replace(/\$\{([A-Z_]+)(?::[-?]([^}]*))?\}/g, (_all, name: string, rest?: string) =>
      defaults[name] !== undefined ? defaults[name] : (rest ?? ''),
    );
  const resolved = (service: string) =>
    Object.fromEntries(
      Object.entries(published.services[service].environment).map(([key, value]) => [
        key,
        resolve(value),
      ]),
    );
  const publishedStore = resolved('store');
  try {
    const config = loadStoreConfig(publishedStore);
    check(
      config.providers[0]?.id === 'oidc' && config.retiredSettings.length === 0,
      'the store would start with it, and it sets nothing the store no longer reads',
    );
    check(
      config.adminGroups.length > 0 || config.admins.length > 0,
      'as shipped it names administrators, so someone can create the first workspace',
    );
  } catch (error) {
    check(
      false,
      `the store would start with these settings (${error instanceof ConfigError ? error.message : String(error)})`,
    );
  }
  check(
    resolved('relay').RELAY_TOKEN_SECRET === publishedStore.RELAY_TOKEN_SECRET &&
      !!publishedStore.RELAY_TOKEN_SECRET,
    'the relay and the store are given the same token secret',
  );
  check(
    resolved('editor').STORE_URL === publishedStore.PUBLIC_URL,
    "the editor points at the store's public address",
  );
  check(
    published.services.store.volumes.every((volume) => !/recovery|keys/.test(volume)),
    'and no key files are mounted',
  );
  const publishedRealm = JSON.parse(
    readFileSync('docs-site/docs/files/workspace/keycloak-realm.json', 'utf8'),
  ) as {
    groups?: { name: string }[];
    clients: {
      redirectUris: string[];
      protocolMappers?: { protocolMapper: string; config: Record<string, string> }[];
    }[];
  };
  check(
    publishedRealm.clients[0].redirectUris.includes('https://${DOMAIN}/store/v1/auth/callback'),
    "its Keycloak realm's redirect URI is the store's callback",
  );
  const mapper = publishedRealm.clients[0].protocolMappers?.find(
    (candidate) => candidate.protocolMapper === 'oidc-group-membership-mapper',
  );
  check(
    (publishedRealm.groups ?? []).some(
      (group) =>
        (mapper?.config['full.path'] === 'true' ? `/${group.name}` : group.name) ===
        defaults.ADMIN_GROUPS,
    ),
    `and that realm creates the administrators' group the settings name (${defaults.ADMIN_GROUPS})`,
  );
  const documented = [
    'docs-site/docs/deployment/with-workspaces.md',
    'docs-site/docs/deployment/workspace-store.md',
    'README.md',
  ].filter((path) =>
    /generate-recovery-key|recover-document|recovery-public\.pem|recovery-private/.test(
      readFileSync(path, 'utf8'),
    ),
  );
  check(
    documented.length === 0,
    `the guides that go with it no longer tell anyone to create a recovery key${documented.length ? `: ${documented.join(', ')}` : ''}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll deployment example checks passed.');
