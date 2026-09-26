/**
 * The grant check (WS14-R20 to R25), the security boundary of automatic
 * access.
 *
 * One valid join passes; then each check is broken on its own and must fail
 * with its own reason. The case that matters most is "a real token with the
 * attacker's key": a store that could make that pass could let itself in.
 *
 * Tokens are signed here in all three accepted algorithms, so signature
 * verification is exercised for real, not stubbed.
 */
import { constants, createHmac, generateKeyPairSync, sign as nodeSign } from 'crypto';
import {
  createJwksSource,
  parseAccessRule,
  verifyJoinEvidence,
  type AccessRule,
  type JoinEvidence,
  type Jwk,
  type KeySource,
  type RejectionReason,
} from '../src/crypto/idToken.ts';
import { joinCommitment, newJoinSalt } from '../src/crypto/joinCommitment.ts';
import { exportPublicKey, generateWrappingKeyPair } from '../src/crypto/keys.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const ISSUER = 'https://keycloak.example.gov/realms/system-design';
const AUDIENCE = 'system-design-store';
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const nowSeconds = Math.floor(NOW / 1000);

type Alg = 'RS256' | 'PS256' | 'ES256';
interface Signer {
  alg: Alg;
  kid: string;
  jwk: Jwk;
  sign(data: Uint8Array): Uint8Array;
}

/**
 * Tokens are signed with Node's own crypto and verified with WebCrypto, so
 * the two sides of every check here are independent implementations.
 */
function makeSigner(alg: Alg, kid: string): Signer {
  const { privateKey, publicKey } =
    alg === 'ES256'
      ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
      : generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    alg,
    kid,
    jwk: { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid, use: 'sig', alg },
    sign: (data) =>
      new Uint8Array(
        alg === 'ES256'
          ? nodeSign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' })
          : alg === 'PS256'
            ? nodeSign('sha256', data, {
                key: privateKey,
                padding: constants.RSA_PKCS1_PSS_PADDING,
                saltLength: 32,
              })
            : nodeSign('sha256', data, privateKey),
      ),
  };
}

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const b64uJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

async function token(
  signer: Signer,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const head = b64uJson({ alg: signer.alg, typ: 'JWT', kid: signer.kid, ...header });
  const body = b64uJson(claims);
  const signature = signer.sign(new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(signature)}`;
}

function staticKeys(keysFirst: Jwk[], keysAfterRefresh = keysFirst) {
  let refreshes = 0;
  const source: KeySource & { refreshes: () => number } = {
    async keys(_issuer, options) {
      if (options?.refresh) {
        refreshes++;
        return keysAfterRefresh;
      }
      return keysFirst;
    },
    refreshes: () => refreshes,
  };
  return source;
}

const rule: AccessRule = parseAccessRule({
  schema: 1,
  ruleVersion: 7,
  enabled: true,
  issuer: ISSUER,
  audience: AUDIENCE,
  claim: 'groups',
  groups: ['/design-team-a', '/engineering/design'],
  evidenceMaxAgeSeconds: 86_400,
});

const rs = makeSigner('RS256', 'rs-1');
const ps = makeSigner('PS256', 'ps-1');
const es = makeSigner('ES256', 'es-1');
const intruder = makeSigner('RS256', 'rs-1'); // same kid, different key
const keys = staticKeys([rs.jwk, ps.jwk, es.jwk]);

// The newcomer's real key and salt, and an attacker's.
const newcomerKey = await exportPublicKey((await generateWrappingKeyPair('user')).publicKey);
const attackerKey = await exportPublicKey((await generateWrappingKeyPair('user')).publicKey);
const salt = newJoinSalt();
const nonce = await joinCommitment(newcomerKey, salt);

const goodClaims = {
  iss: ISSUER,
  aud: AUDIENCE,
  sub: 'otter-uuid',
  iat: nowSeconds - 600,
  exp: nowSeconds - 300, // already expired: exp must not matter
  nonce,
  groups: ['/design-team-a', '/other'],
  name: 'Otter',
};

function evidence(idToken: string, overrides: Partial<JoinEvidence> = {}): JoinEvidence {
  return {
    issuer: ISSUER,
    subject: 'otter-uuid',
    publicKey: newcomerKey,
    salt,
    idToken,
    ...overrides,
  };
}

async function run(
  idToken: string,
  options: {
    rule?: AccessRule | null;
    seen?: number;
    evidence?: Partial<JoinEvidence>;
    keySource?: KeySource;
  } = {},
) {
  return verifyJoinEvidence(
    evidence(idToken, options.evidence),
    options.rule === undefined ? rule : options.rule,
    {
      keySource: options.keySource ?? keys,
      seenRuleVersion: options.seen ?? 0,
      now: () => NOW,
    },
  );
}

async function expectReason(
  label: string,
  outcome: Promise<Awaited<ReturnType<typeof run>>>,
  reason: RejectionReason,
) {
  const result = await outcome;
  check(
    !result.ok && result.reason === reason,
    `${label} → ${reason}${result.ok ? ' (but it PASSED)' : result.reason !== reason ? ` (got ${result.reason})` : ''}`,
  );
}

console.log('=== A valid join passes ===');
for (const signer of [rs, ps, es]) {
  const result = await run(await token(signer, goodClaims));
  check(
    result.ok && result.matchedGroup === '/design-team-a',
    `${signer.alg}: accepted, matched /design-team-a`,
  );
}
{
  const result = await run(
    await token(rs, { ...goodClaims, aud: ['other-app', AUDIENCE], azp: AUDIENCE }),
  );
  check(result.ok, 'aud as an array containing the client, with a matching azp');
  const later = await run(await token(rs, goodClaims), { seen: 6 });
  check(later.ok, 'a rule newer than the one seen is fine');
  const same = await run(await token(rs, goodClaims), { seen: 7 });
  check(same.ok, 'the same rule version as the one seen is fine');
}

console.log('\n=== R20: the rule ===');
await expectReason(
  'no sealed rule',
  run(await token(rs, goodClaims), { rule: null }),
  'rule-missing',
);
await expectReason(
  'rule turned off',
  run(await token(rs, goodClaims), { rule: { ...rule, enabled: false } }),
  'rule-disabled',
);
await expectReason(
  'an older rule than one already seen (store rollback)',
  run(await token(rs, goodClaims), { seen: 8 }),
  'rule-rollback',
);

console.log('\n=== R23: signatures and algorithms ===');
await expectReason(
  'signed by a key not in the JWKS, same kid',
  run(await token(intruder, goodClaims)),
  'bad-signature',
);
{
  const good = await token(rs, goodClaims);
  const [h, , s] = good.split('.');
  const tampered = `${h}.${b64uJson({ ...goodClaims, groups: ['/design-team-a', '/admins'] })}.${s}`;
  await expectReason('claims edited after signing', run(tampered), 'bad-signature');
  await expectReason('signature stripped', run(`${h}.${b64uJson(goodClaims)}.`), 'bad-signature');
}
await expectReason(
  'alg: none',
  run(`${b64uJson({ alg: 'none', typ: 'JWT' })}.${b64uJson(goodClaims)}.`),
  'bad-alg',
);
{
  // The classic confusion: HS256 keyed with the provider's public key.
  const secret = JSON.stringify(rs.jwk);
  const head = b64uJson({ alg: 'HS256', typ: 'JWT', kid: 'rs-1' });
  const body = b64uJson(goodClaims);
  const mac = new Uint8Array(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  await expectReason(
    'HS256 with the public key as the secret',
    run(`${head}.${body}.${b64u(mac)}`),
    'bad-alg',
  );
}
await expectReason('RS512', run(await token(rs, goodClaims, { alg: 'RS512' })), 'bad-alg');
await expectReason('not a JWT at all', run('not-a-token'), 'bad-signature');
await expectReason(
  'a JWK marked for encryption is not used to verify',
  run(await token(rs, goodClaims), { keySource: staticKeys([{ ...rs.jwk, use: 'enc' }]) }),
  'unknown-key',
);
await expectReason(
  'a JWK pinned to another algorithm is not used',
  run(await token(rs, goodClaims), { keySource: staticKeys([{ ...rs.jwk, alg: 'RS512' }]) }),
  'unknown-key',
);

console.log('\n=== R21: finding the keys ===');
{
  const unknown = staticKeys([ps.jwk]);
  await expectReason(
    'a kid the provider does not publish',
    run(await token(rs, goodClaims), { keySource: unknown }),
    'unknown-key',
  );
  check(unknown.refreshes() === 1, 'an unknown kid is refetched exactly once');
  const rotated = staticKeys([ps.jwk], [ps.jwk, rs.jwk]);
  const result = await run(await token(rs, goodClaims), { keySource: rotated });
  check(
    result.ok && rotated.refreshes() === 1,
    'a provider that rotated keys is followed after one refresh',
  );
  const known = staticKeys([rs.jwk]);
  await run(await token(rs, goodClaims), { keySource: known });
  check(known.refreshes() === 0, 'a known kid causes no refetch');
  const broken: KeySource = {
    async keys() {
      throw new Error('CORS: blocked');
    },
  };
  await expectReason(
    'keys cannot be fetched',
    run(await token(rs, goodClaims), { keySource: broken }),
    'discovery-failed',
  );
}

console.log('\n=== R24: issuer, audience, time, subject ===');
await expectReason(
  'another issuer',
  run(await token(rs, { ...goodClaims, iss: 'https://evil.example/realms/x' })),
  'wrong-issuer',
);
await expectReason(
  'another audience',
  run(await token(rs, { ...goodClaims, aud: 'some-other-client' })),
  'wrong-audience',
);
await expectReason(
  'azp names another client',
  run(await token(rs, { ...goodClaims, azp: 'some-other-client' })),
  'wrong-audience',
);
await expectReason(
  'issued longer ago than the rule allows',
  run(await token(rs, { ...goodClaims, iat: nowSeconds - 86_401 })),
  'too-old',
);
await expectReason(
  'no iat at all',
  run(await token(rs, { ...goodClaims, iat: undefined })),
  'too-old',
);
await expectReason(
  'issued three minutes in the future',
  run(await token(rs, { ...goodClaims, iat: nowSeconds + 180 })),
  'future-iat',
);
{
  const skewed = await run(await token(rs, { ...goodClaims, iat: nowSeconds + 60 }));
  check(skewed.ok, 'a minute of clock skew is tolerated');
}
await expectReason(
  'the store names someone else as asking',
  run(await token(rs, goodClaims), { evidence: { subject: 'badger-uuid' } }),
  'subject-mismatch',
);
await expectReason(
  'the store names another issuer for the asker',
  run(await token(rs, goodClaims), { evidence: { issuer: 'https://github.com' } }),
  'subject-mismatch',
);

console.log('\n=== R22: the token vouches for the key ===');
await expectReason(
  "a real token paired with the attacker's key",
  run(await token(rs, goodClaims), { evidence: { publicKey: attackerKey } }),
  'nonce-mismatch',
);
await expectReason(
  'the right key with another salt',
  run(await token(rs, goodClaims), { evidence: { salt: newJoinSalt() } }),
  'nonce-mismatch',
);
await expectReason(
  'a sign-in with a random nonce (no commitment)',
  run(await token(rs, { ...goodClaims, nonce: 'x'.repeat(43) })),
  'nonce-mismatch',
);
{
  // The attacker commits to their own key, but the IdP signed the newcomer's nonce.
  const attackerSalt = newJoinSalt();
  await expectReason(
    'the attacker supplies a salt and key of their own',
    run(await token(rs, goodClaims), { evidence: { publicKey: attackerKey, salt: attackerSalt } }),
    'nonce-mismatch',
  );
}

console.log('\n=== R25: groups ===');
await expectReason(
  'a bare group name where the rule has a full path',
  run(await token(rs, { ...goodClaims, groups: ['design-team-a'] })),
  'no-group-match',
);
await expectReason(
  'case differs',
  run(await token(rs, { ...goodClaims, groups: ['/Design-Team-A'] })),
  'no-group-match',
);
await expectReason(
  'groups as a string, not an array',
  run(await token(rs, { ...goodClaims, groups: '/design-team-a' })),
  'no-group-match',
);
await expectReason(
  'no groups claim',
  run(await token(rs, { ...goodClaims, groups: undefined })),
  'no-group-match',
);
await expectReason(
  'a parent of the ruled subgroup',
  run(await token(rs, { ...goodClaims, groups: ['/engineering'] })),
  'no-group-match',
);
await expectReason(
  'Entra-style overage',
  run(await token(rs, { ...goodClaims, groups: undefined, _claim_names: { groups: 'src1' } })),
  'groups-overage',
);
{
  const custom = await run(
    await token(rs, { ...goodClaims, groups: undefined, roles: ['/design-team-a'] }),
    {
      rule: { ...rule, claim: 'roles' },
    },
  );
  check(custom.ok, 'the claim name comes from the rule');
}

console.log('\n=== The rule itself (R8) ===');
{
  const base = {
    schema: 1,
    ruleVersion: 1,
    enabled: true,
    issuer: ISSUER,
    audience: AUDIENCE,
    claim: 'groups',
    groups: ['/a'],
  };
  const refuses = (label: string, value: unknown) => {
    let threw = false;
    try {
      parseAccessRule(value);
    } catch {
      threw = true;
    }
    check(threw, `refuses ${label}`);
  };
  check(
    parseAccessRule(base).evidenceMaxAgeSeconds === 86_400,
    'evidence validity defaults to 24 h',
  );
  check(
    parseAccessRule({ ...base, issuer: `${ISSUER}/` }).issuer === ISSUER,
    'a trailing slash on the issuer is normalised',
  );
  refuses('an unknown schema', { ...base, schema: 2 });
  refuses('no groups', { ...base, groups: [] });
  refuses('51 groups', { ...base, groups: Array.from({ length: 51 }, (_, i) => `/g${i}`) });
  refuses('an empty group', { ...base, groups: [''] });
  refuses('evidence validity under 5 minutes', { ...base, evidenceMaxAgeSeconds: 299 });
  refuses('evidence validity over 7 days', { ...base, evidenceMaxAgeSeconds: 604_801 });
  refuses('a version of 0', { ...base, ruleVersion: 0 });
  refuses('a relative issuer', { ...base, issuer: '/realms/x' });
}

console.log('\n=== The key source ===');
{
  let fetches = 0;
  let declared = ISSUER;
  const fetcher = (async (input: string) => {
    fetches++;
    const target = String(input);
    if (target.endsWith('/.well-known/openid-configuration'))
      return new Response(
        JSON.stringify({ issuer: declared, jwks_uri: `${ISSUER}/protocol/openid-connect/certs` }),
      );
    if (target.endsWith('/certs')) return new Response(JSON.stringify({ keys: [rs.jwk] }));
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  let clock = NOW;
  const source = createJwksSource({ fetcher, now: () => clock });
  const first = await source.keys(ISSUER);
  check(first.length === 1 && fetches === 2, 'fetches discovery, then the key set');
  await source.keys(ISSUER);
  check(fetches === 2, 'serves from cache within the hour');
  clock += 3_600_001;
  await source.keys(ISSUER);
  check(fetches === 4, 'refetches after an hour');
  await source.keys(ISSUER, { refresh: true });
  check(fetches === 6, 'refresh skips the cache');
  declared = 'https://someone-else.example';
  let threw = false;
  try {
    await source.keys(ISSUER, { refresh: true });
  } catch {
    threw = true;
  }
  check(threw, 'refuses a discovery document naming another issuer');
  threw = false;
  try {
    await createJwksSource({ fetcher }).keys('http://keycloak.example.gov/realms/x');
  } catch {
    threw = true;
  }
  check(threw, 'refuses plain http off loopback');
  threw = false;
  try {
    const local = createJwksSource({
      fetcher: (async (input: string) =>
        String(input).endsWith('configuration')
          ? new Response(
              JSON.stringify({
                issuer: 'http://127.0.0.1:8081',
                jwks_uri: 'http://127.0.0.1:8081/certs',
              }),
            )
          : new Response(JSON.stringify({ keys: [] }))) as unknown as typeof fetch,
    });
    await local.keys('http://127.0.0.1:8081');
  } catch {
    threw = true;
  }
  check(!threw, 'allows plain http on loopback, for development');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll grant verification checks passed.');
