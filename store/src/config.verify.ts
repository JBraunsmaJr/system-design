/** WS8-R9: the store's configuration, and what it refuses to start with. */
import { ConfigError, describeConfig, loadStoreConfig } from './config.ts';

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
  PUBLIC_URL: 'https://store.example.gov',
  ALLOWED_ORIGINS: 'https://design.example.gov',
  AUTH_PROVIDERS: 'oidc',
  OIDC_ISSUER: 'https://keycloak.example.gov/realms/design',
  OIDC_CLIENT_ID: 'system-design-store',
  OIDC_CLIENT_SECRET: 'secret',
  DATABASE_URL: 'postgresql://store@db/store',
};

console.log('=== A working configuration ===');
{
  const config = loadStoreConfig(WORKING);
  assert(
    config.port === 8080 && config.publicUrl === 'https://store.example.gov',
    'defaults where nothing is set',
  );
  assert(
    config.providers[0]?.kind === 'oidc' && (config.providers[0].issuer ?? '').includes('keycloak'),
    'the identity provider is configured',
  );
  assert(config.retention.kind === 'duration', 'retention defaults to a duration (30d)');
  const described = describeConfig(config).join('\n');
  assert(
    /PostgreSQL/.test(described) && /keycloak|oidc/i.test(described),
    'startup prints what it is',
  );
  assert(
    /Administrators: none configured/.test(described),
    'including that no administrator is configured',
  );
}

console.log('\n=== Where people land after signing in ===');
{
  const config = loadStoreConfig(WORKING);
  assert(
    config.afterLoginUrl === 'https://design.example.gov',
    "by default, the editor - not the store's own root",
  );
  assert(
    loadStoreConfig({
      ...WORKING,
      AFTER_LOGIN_URL: 'https://design.example.gov/system-design/',
    }).afterLoginUrl.startsWith('https://design.example.gov'),
    'a path within the editor can be set',
  );
  assert(
    loadStoreConfig({ ...WORKING, ALLOWED_ORIGINS: '' }).afterLoginUrl ===
      'https://store.example.gov',
    "with no editor origin, the store's own address",
  );
}

console.log('\n=== What it refuses ===');
refuses({ ...WORKING, PUBLIC_URL: undefined }, /PUBLIC_URL is required/, 'no public address');
refuses(
  { ...WORKING, PUBLIC_URL: 'store.example.gov' },
  /absolute URL/,
  'a public address that is not a URL',
);
refuses(
  { ...WORKING, AUTH_PROVIDERS: '' },
  /No sign-in is configured/,
  'no sign-in, unless development is declared',
);
refuses(
  { ...WORKING, AUTH_PROVIDERS: 'saml' },
  /unknown provider/,
  'a provider it does not support',
);
refuses(
  {
    ...WORKING,
    OIDC_CLIENT_SECRET: undefined,
  },
  /OIDC_CLIENT_SECRET is required/,
  'an identity provider with no secret',
);
refuses(
  {
    ...WORKING,
    AUTH_PROVIDERS: 'github',
    GITHUB_CLIENT_ID: undefined,
  },
  /GITHUB_CLIENT_ID is required/,
  'GitHub with no client id',
);
refuses(
  {
    ...WORKING,
    RETENTION_PERIOD: 'thirty days',
  },
  /Unrecognized retention period/,
  'a retention period it cannot parse',
);
refuses({ ...WORKING, MAX_BLOB_BYTES: '-1' }, /must be a positive number/, 'a negative limit');
refuses(
  { ...WORKING, AFTER_LOGIN_URL: 'https://elsewhere.example.com/' },
  /open redirect/,
  'sending people somewhere untrusted after they sign in',
);
// The one that would look fine and then fail in the browser: a cross-origin
// editor needs SameSite=None, which needs HTTPS.
refuses(
  {
    ...WORKING,
    PUBLIC_URL: 'http://store.example.gov',
    ALLOWED_ORIGINS: 'http://design.example.gov',
  },
  /HTTPS/,
  'a cross-origin editor over plain HTTP, whose cookies a browser would silently drop',
);

console.log('\n=== Development ===');
{
  const dev = loadStoreConfig({
    PUBLIC_URL: 'http://localhost:8080',
    ALLOW_UNAUTHENTICATED: 'true',
  });
  assert(
    dev.allowUnauthenticated && dev.providers.length === 0,
    'no sign-in is allowed when declared explicitly',
  );
  assert(
    /Sign-in: NONE/.test(describeConfig(dev).join('\n')),
    'and startup says so in as many words',
  );
  const local = loadStoreConfig({
    ...WORKING,
    PUBLIC_URL: 'http://localhost:8080',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  });
  assert(
    local.allowedOrigins.length === 1,
    'localhost over plain HTTP is allowed, because browsers treat it as secure',
  );
}

console.log('\n=== Retention and limits ===');
{
  const strict = loadStoreConfig({
    ...WORKING,
    RETENTION_PERIOD: '7y',
    ADMIN_SUBJECTS: 'https://idp#alice, https://idp#bob',
  });
  assert(
    strict.retention.kind === 'duration' && strict.admins.length === 2,
    'a records schedule and administrators are read',
  );
  assert(
    strict.adminGroups.length === 0 && strict.workspaceCreation === 'admins',
    'with nothing set there are no administrator groups, and only administrators create workspaces',
  );
  const grouped = loadStoreConfig({
    ...WORKING,
    ADMIN_GROUPS: 'notebook-admin, platform-leads',
    WORKSPACE_CREATION: 'Anyone',
  });
  assert(
    grouped.adminGroups.join('|') === 'notebook-admin|platform-leads' &&
      grouped.workspaceCreation === 'anyone',
    'administrator groups and the workspace creation policy are read',
  );
  assert(
    /members of notebook-admin, platform-leads/.test(describeConfig(grouped).join('\n')) &&
      /anyone signed in can create one/.test(describeConfig(grouped).join('\n')),
    'and both are announced at startup',
  );
  refuses(
    { ...WORKING, WORKSPACE_CREATION: 'nobody' },
    /WORKSPACE_CREATION must be "admins" or "anyone"/,
    'an unknown workspace creation policy is refused',
  );
  assert(
    /administrators can read them/.test(describeConfig(strict).join('\n')),
    'startup says plainly that this server can read documents',
  );
  assert(
    loadStoreConfig({
      ...WORKING,
      RETENTION_PERIOD: 'immediate',
    }).retention.kind === 'immediate',
    'immediate deletion is configurable',
  );
}

console.log('\n=== Groups ===');
{
  const plain = loadStoreConfig(WORKING);
  assert(plain.providers[0].groupsClaim === 'groups', 'groups are read from "groups" by default');
  assert(
    /Groups: read from the "groups" claim/.test(describeConfig(plain).join('\n')),
    'and startup says so',
  );
  assert(
    loadStoreConfig({ ...WORKING, OIDC_GROUPS_CLAIM: 'roles' }).providers[0].groupsClaim ===
      'roles',
    'OIDC_GROUPS_CLAIM names another claim',
  );
  const github = loadStoreConfig({
    PUBLIC_URL: 'https://store.example.gov',
    AUTH_PROVIDERS: 'github',
    GITHUB_CLIENT_ID: 'x',
    GITHUB_CLIENT_SECRET: 'y',
  });
  assert(
    !/Groups:/.test(describeConfig(github).join('\n')),
    'a GitHub-only store, which has no groups, does not mention them',
  );
  assert(
    plain.providers[0].groupsClaimAbsent === 'no-groups',
    'a token without the groups claim means no groups by default, as Keycloak sends it',
  );
  assert(
    /means no groups/.test(describeConfig(plain).join('\n')),
    'and startup says what a missing claim means',
  );
  assert(
    loadStoreConfig({ ...WORKING, OIDC_GROUPS_CLAIM_ABSENT: 'unknown' }).providers[0]
      .groupsClaimAbsent === 'unknown',
    'OIDC_GROUPS_CLAIM_ABSENT=unknown makes it tell nothing',
  );
  refuses(
    { ...WORKING, OIDC_GROUPS_CLAIM_ABSENT: 'empty' },
    /OIDC_GROUPS_CLAIM_ABSENT/,
    'refuses any other value',
  );
}

console.log('\n=== Settings of the encrypted workspace ===');
{
  const plain = loadStoreConfig(WORKING);
  assert(
    plain.retiredSettings.length === 0 && !/No longer used/.test(describeConfig(plain).join('\n')),
    'a configuration without them says nothing about them',
  );
  const old = loadStoreConfig({
    ...WORKING,
    CRYPTO_MODE: 'passthrough',
    RECOVERY_PUBLIC_KEY_FILE: '/keys/recovery.pub',
    AUTO_ACCESS: 'off',
    JOIN_EVIDENCE_RETENTION: 'forever',
  });
  assert(
    old.retiredSettings.join(',') ===
      'CRYPTO_MODE,RECOVERY_PUBLIC_KEY_FILE,AUTO_ACCESS,JOIN_EVIDENCE_RETENTION',
    'one that still sets them starts anyway, whatever their values, without reading the key file',
  );
  assert(
    /No longer used, and safe to remove: CRYPTO_MODE, RECOVERY_PUBLIC_KEY_FILE, AUTO_ACCESS, JOIN_EVIDENCE_RETENTION/.test(
      describeConfig(old).join('\n'),
    ),
    'and startup names each one as no longer used',
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log('\nAll store configuration checks passed.');
}
