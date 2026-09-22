/**
 * The self-hosting snippets people copy (docs-site/docs/files/core and
 * workspace), held to each other and to the services they configure.
 *
 * The snippets they replace could not have worked: nginx refused the
 * configuration outright (a colon in a directive, an undefined variable,
 * a certificate nothing mounted), the relay was served at one address and
 * configured at another, and the TURN user was spelled differently in the
 * two files that had to agree. Nothing checked them. This does:
 *
 *  - the store's real configuration loader accepts what the workspace
 *    snippets give it, for both sign-in options;
 *  - every value that must agree between files does;
 *  - the nginx configurations carry the routes the compose files assume;
 *  - every file the guides include exists.
 *
 * nginx -t and docker compose config run in CI, where Docker is available.
 */
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadStoreConfig } from '../store/src/config.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const FILES = 'docs-site/docs/files';
const read = (path: string) => readFileSync(join(FILES, path), 'utf8').replace(/\r\n/g, '\n');

/** KEY=value lines, ignoring comments - commented lines are returned
 * separately, for the Option B values. */
function readEnv(text: string) {
  const active: Record<string, string> = {};
  const commented: Record<string, string> = {};
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    (match[1] ? commented : active)[match[2]] = match[3].trim();
  }
  return { active, commented };
}

/** One service's environment block, as written in our compose files:
 * `  name:` then `    environment:` then `      KEY: value` lines. */
function serviceEnvironment(compose: string, service: string): Record<string, string> {
  const lines = compose.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) return {};
  const out: Record<string, string> = {};
  let inEnv = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || /^\S/.test(line)) break;
    if (/^ {4}environment:\s*$/.test(line)) {
      inEnv = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) inEnv = false;
    const match = inEnv && /^ {6}([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^'(.*)'$/, '$1');
  }
  return out;
}

/** Compose's ${VAR}, ${VAR:-default} and ${VAR:?message}. */
function interpolate(value: string, env: Record<string, string>): string {
  return value.replace(
    /\$\{([A-Z0-9_]+)(?::([-?])([^}]*))?\}/g,
    (_, name: string, op: string, arg: string) => {
      const set = env[name];
      if (set) return set;
      if (op === '-') return arg;
      if (op === '?') throw new Error(`${name} is required: ${arg}`);
      return '';
    },
  );
}

const secret = () => 'a'.repeat(64);

console.log('=== Core ===');
{
  const compose = read('core/compose.yml');
  const env = readEnv(read('core/core.env')).active;
  const nginx = read('core/nginx.conf');
  const editor = serviceEnvironment(compose, 'editor');
  check(env.DOMAIN === 'design.example.gov', 'the .env names a domain to replace');
  check(
    interpolate(editor.RELAY, env) === 'wss://design.example.gov/relay/',
    'the editor reaches the relay at /relay/, with the slash nginx needs',
  );
  check(
    interpolate(editor.APP_URL, env) === 'https://design.example.gov/',
    'and knows its own address',
  );
  check(
    /location \/relay\/ \{[^}]*proxy_pass http:\/\/relay:4444\/;/s.test(nginx),
    'nginx serves the relay at /relay/, stripping the prefix',
  );
  check(/location \/ \{[^}]*proxy_pass http:\/\/editor:80;/s.test(nginx), 'and the editor at /');
}

console.log('\n=== Both nginx configurations are ones nginx accepts ===');
for (const path of ['core/nginx.conf', 'workspace/nginx.conf']) {
  const nginx = read(path);
  // The mistakes that made the previous configuration unusable.
  check(!/^\s*[a-z_]+:\s/m.test(nginx), `${path}: no "directive:" colons`);
  check(
    !nginx.includes('$connection_upgrade') || /map \$http_upgrade \$connection_upgrade/.test(nginx),
    `${path}: $connection_upgrade is defined before use`,
  );
  check(!/\[::\]/.test(nginx), `${path}: no IPv6 listen, which fails on hosts without it`);
  check(
    /ssl_certificate\s+\/etc\/nginx\/certs\/fullchain\.pem;/.test(nginx) &&
      /ssl_certificate_key\s+\/etc\/nginx\/certs\/privkey\.pem;/.test(nginx),
    `${path}: the certificate names the guide tells people to use`,
  );
}

console.log('\n=== With workspaces ===');
const compose = read('workspace/compose.yml');
const keycloakCompose = read('workspace/compose.keycloak.yml');
const { active, commented } = readEnv(read('workspace/workspace.env'));
const nginx = read('workspace/nginx.conf');
const realm = JSON.parse(read('workspace/keycloak-realm.json')) as {
  realm: string;
  clients: { clientId: string; secret: string; redirectUris: string[]; publicClient: boolean }[];
};
const filled = {
  ...active,
  POSTGRES_PASSWORD: secret(),
  RELAY_TOKEN_SECRET: secret(),
  OIDC_CLIENT_SECRET: secret(),
};
const editor = serviceEnvironment(compose, 'editor');
const relay = serviceEnvironment(compose, 'relay');
const store = serviceEnvironment(compose, 'store');
const keycloak = serviceEnvironment(keycloakCompose, 'keycloak');

for (const name of ['POSTGRES_PASSWORD', 'RELAY_TOKEN_SECRET', 'OIDC_CLIENT_SECRET']) {
  check(active[name] === '', `${name} is left for people to generate, not shipped with a value`);
  check(compose.includes(`\${${name}:?`), `and compose refuses to start without it`);
}

const scratch = mkdtempSync(join(tmpdir(), 'selfhost-'));
try {
  const keyFile = join(scratch, 'recovery-public.pem');
  writeFileSync(keyFile, '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----\n');
  const storeEnv = (values: Record<string, string>) => {
    const env = Object.fromEntries(
      Object.entries(store).map(([key, value]) => [key, interpolate(value, values)]),
    );
    // The file is mounted at this path in the container; read the stand-in.
    check(
      env.RECOVERY_PUBLIC_KEY_FILE === '/run/keys/recovery-public.pem',
      'the store reads the recovery key from where compose mounts it',
    );
    return { ...env, RECOVERY_PUBLIC_KEY_FILE: keyFile };
  };

  for (const [option, values] of [
    ['Option A (your provider)', filled],
    [
      'Option B (Keycloak here)',
      {
        ...filled,
        OIDC_ISSUER: commented.OIDC_ISSUER,
        OIDC_INTERNAL_URL: commented.OIDC_INTERNAL_URL,
        OIDC_CLIENT_ID: commented.OIDC_CLIENT_ID,
      },
    ],
  ] as const) {
    try {
      const config = loadStoreConfig(storeEnv(values));
      check(true, `${option}: the store's own configuration loader accepts it`);
      check(config.relayTokenSecret !== null, `${option}: sessions require signing in`);
      check(config.recoveryPublicKeyPem !== null, `${option}: documents are escrowed`);
      check(
        config.allowedOrigins.length === 0,
        `${option}: one origin, so no cross-site cookie rules apply`,
      );
      // Compared as URLs: the store drops a trailing slash, which names the
      // same page.
      check(
        new URL(config.afterLoginUrl).href === 'https://design.example.gov/',
        `${option}: signing in returns people to the editor`,
      );
    } catch (error) {
      check(false, `${option}: the store's configuration loader refuses it (${String(error)})`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

check(
  interpolate(editor.STORE_URL, filled) === interpolate(store.PUBLIC_URL, filled),
  "the editor's STORE_URL is the store's PUBLIC_URL",
);
check(
  relay.RELAY_TOKEN_SECRET?.startsWith('${RELAY_TOKEN_SECRET') &&
    store.RELAY_TOKEN_SECRET?.startsWith('${RELAY_TOKEN_SECRET'),
  'the relay and the store share one RELAY_TOKEN_SECRET',
);
check(
  /location \/store\/ \{[^}]*proxy_pass http:\/\/store:8080\/;/s.test(nginx),
  'nginx serves the store at /store/, stripping the prefix',
);
check(
  /location \/relay\/ \{[^}]*proxy_pass http:\/\/relay:4444\/;/s.test(nginx),
  'and the relay at /relay/',
);
check(
  /location \/auth\/ \{[^}]*resolver 127\.0\.0\.11/s.test(nginx),
  'and Keycloak at /auth/, resolved per request so nginx starts without it',
);
check(
  /client_max_body_size\s+16m/.test(nginx),
  'uploads of an 8 MB encrypted blob fit through the proxy',
);

console.log('\n=== Keycloak, if run here ===');
{
  const optionB = { ...filled, OIDC_ISSUER: commented.OIDC_ISSUER };
  check(
      `https://${interpolate(keycloak.KC_HOSTNAME, optionB)}${keycloak.KC_HTTP_RELATIVE_PATH}/realms/${realm.realm}` === optionB.OIDC_ISSUER,
      `Keycloak's public address and the realm make exactly the issuer the store expects (${optionB.OIDC_ISSUER})`,
  );
  check(
    keycloak.KC_HTTP_RELATIVE_PATH === '/auth',
    'Keycloak serves under /auth, where nginx sends it',
  );
  check(
    commented.OIDC_INTERNAL_URL === 'http://keycloak:8080',
    'the store reaches it by service name, not through the proxy',
  );
  const client = realm.clients[0];
  check(
    client.clientId === commented.OIDC_CLIENT_ID,
    'the realm registers the client ID the store uses',
  );
  check(
    client.secret === '${OIDC_CLIENT_SECRET}' &&
      keycloak.OIDC_CLIENT_SECRET === '${OIDC_CLIENT_SECRET}',
    'with the same client secret, read from .env - nothing to copy by hand',
  );
  check(
    client.redirectUris.includes('https://${DOMAIN}/store/v1/auth/callback') &&
      keycloak.DOMAIN === '${DOMAIN}',
    "and the redirect URI is exactly the store's callback",
  );
  check(!client.publicClient, 'as a confidential client');
  check(!('users' in realm), 'with no demo accounts: people are added deliberately');
  check(
    /KEYCLOAK_ADMIN_PASSWORD:\?/.test(keycloakCompose),
    "and it won't start without an admin password",
  );
}

console.log('\n=== TURN ===');
{
  const turn = read('turnserver.conf');
  const user = /^user=([^:]+):/m.exec(turn)?.[1];
  const selfHost = readFileSync('docs-site/docs/deployment/self-host.md', 'utf8');
  const iceUser = /ICE_SERVERS=turn:[^|]+\|([^|]+)\|/.exec(selfHost)?.[1];
  check(
    !!user && user === iceUser,
    `the TURN user and the ICE_SERVERS example agree (${user} / ${iceUser})`,
  );
}

console.log('\n=== The guides include files that exist ===');
for (const page of readdirSync('docs-site/docs/deployment').filter((name) =>
  name.endsWith('.md'),
)) {
  const text = readFileSync(join('docs-site/docs/deployment', page), 'utf8');
  for (const match of text.matchAll(/<!--@include: @\/files\/([^ ]+) -->/g)) {
    check(existsSync(join(FILES, match[1])), `${page} includes files/${match[1]}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll self-hosting snippet checks passed.');
