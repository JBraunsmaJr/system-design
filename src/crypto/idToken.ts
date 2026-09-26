/**
 * Checking a join request before granting (WS14-R20 to R25, R29).
 *
 * This is the security boundary of automatic access. A member's browser
 * wraps the workspace key to a newcomer only if every check here passes, and
 * nothing here trusts the store: the rule comes from the sealed index, the
 * signing keys come straight from the identity provider, and the key being
 * granted to is tied to the token by the nonce (joinCommitment.ts).
 *
 * WebCrypto only, no dependencies, so the editor can run it and a reviewer
 * can read all of it. Every failure has a reason code (WS14-R27) that the
 * granter reports back and the interface can put into words.
 */
import { matchesJoinCommitment } from './joinCommitment.ts';

// -- the access rule (WS14-R8) ------------------------------------------

export interface AccessRule {
  schema: 1;
  /** Increases by exactly one on every change (WS14-R9). */
  ruleVersion: number;
  enabled: boolean;
  /** The issuer as tokens claim it, which is the browser-facing one. */
  issuer: string;
  /** The store's OIDC client id: tokens must be issued to it. */
  audience: string;
  /** The ID-token claim holding groups. */
  claim: string;
  /** Exact, case-sensitive group values. Keycloak full paths start with `/`. */
  groups: string[];
  evidenceMaxAgeSeconds: number;
  updatedBy?: string;
  updatedAt?: string;
}

export const EVIDENCE_MAX_AGE_DEFAULT = 86_400;
export const EVIDENCE_MAX_AGE_MIN = 300;
export const EVIDENCE_MAX_AGE_MAX = 604_800;
export const MAX_RULE_GROUPS = 50;

export class AccessRuleError extends Error {}

/**
 * Validates a rule read from the sealed index or built in the settings
 * screen. Throws with a sentence rather than repairing: a rule quietly
 * "fixed" into something nobody wrote would admit people nobody chose.
 */
export function parseAccessRule(value: unknown): AccessRule {
  if (!value || typeof value !== 'object') throw new AccessRuleError('The rule is not an object.');
  const rule = value as Record<string, unknown>;
  if (rule.schema !== 1) throw new AccessRuleError(`Unknown rule schema ${String(rule.schema)}.`);
  if (!Number.isSafeInteger(rule.ruleVersion) || (rule.ruleVersion as number) < 1)
    throw new AccessRuleError('ruleVersion must be a positive integer.');
  if (typeof rule.enabled !== 'boolean')
    throw new AccessRuleError('enabled must be true or false.');
  for (const field of ['issuer', 'audience', 'claim'] as const) {
    if (typeof rule[field] !== 'string' || (rule[field] as string).length === 0)
      throw new AccessRuleError(`${field} is required.`);
  }
  try {
    new URL(rule.issuer as string);
  } catch {
    throw new AccessRuleError('issuer must be an absolute URL.');
  }
  const groups = rule.groups;
  if (
    !Array.isArray(groups) ||
    groups.length < 1 ||
    groups.length > MAX_RULE_GROUPS ||
    !groups.every((group) => typeof group === 'string' && group.length > 0)
  ) {
    throw new AccessRuleError(`groups must be 1 to ${MAX_RULE_GROUPS} non-empty strings.`);
  }
  const maxAge = rule.evidenceMaxAgeSeconds ?? EVIDENCE_MAX_AGE_DEFAULT;
  if (
    !Number.isSafeInteger(maxAge) ||
    (maxAge as number) < EVIDENCE_MAX_AGE_MIN ||
    (maxAge as number) > EVIDENCE_MAX_AGE_MAX
  ) {
    throw new AccessRuleError(
      `evidenceMaxAgeSeconds must be between ${EVIDENCE_MAX_AGE_MIN} and ${EVIDENCE_MAX_AGE_MAX}.`,
    );
  }
  return {
    schema: 1,
    ruleVersion: rule.ruleVersion as number,
    enabled: rule.enabled,
    issuer: (rule.issuer as string).replace(/\/+$/, ''),
    audience: rule.audience as string,
    claim: rule.claim as string,
    groups: [...new Set(groups as string[])],
    evidenceMaxAgeSeconds: maxAge as number,
    ...(typeof rule.updatedBy === 'string' ? { updatedBy: rule.updatedBy } : {}),
    ...(typeof rule.updatedAt === 'string' ? { updatedAt: rule.updatedAt } : {}),
  };
}

// -- reasons (WS14-R27) --------------------------------------------------

export type RejectionReason =
  | 'rule-missing'
  | 'rule-disabled'
  | 'rule-rollback'
  | 'discovery-failed'
  | 'unknown-key'
  | 'bad-signature'
  | 'bad-alg'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'too-old'
  | 'future-iat'
  | 'subject-mismatch'
  | 'nonce-mismatch'
  | 'no-group-match'
  | 'groups-overage';

export const REJECTION_REASONS: readonly RejectionReason[] = [
  'rule-missing',
  'rule-disabled',
  'rule-rollback',
  'discovery-failed',
  'unknown-key',
  'bad-signature',
  'bad-alg',
  'wrong-issuer',
  'wrong-audience',
  'too-old',
  'future-iat',
  'subject-mismatch',
  'nonce-mismatch',
  'no-group-match',
  'groups-overage',
];

// -- signing keys (WS14-R21) --------------------------------------------

export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  crv?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
}

export interface KeySource {
  /** The issuer's signing keys; `refresh` skips any cache. Throws
   * `DiscoveryError` when they cannot be had. */
  keys(issuer: string, options?: { refresh?: boolean }): Promise<Jwk[]>;
}

export class DiscoveryError extends Error {}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function requireSecureUrl(value: string, what: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DiscoveryError(`${what} is not a URL: ${value}`);
  }
  if (parsed.protocol === 'https:') return parsed;
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed;
  throw new DiscoveryError(`${what} must use https: ${value}`);
}

/**
 * Fetches discovery and the JWKS directly from the issuer, never through the
 * store: a store that could choose the keys could choose the verdict.
 */
export function createJwksSource(
  options: { fetcher?: typeof fetch; now?: () => number; ttlMs?: number } = {},
): KeySource {
  const fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const ttlMs = Math.min(options.ttlMs ?? 3_600_000, 3_600_000);
  const cache = new Map<string, { keys: Jwk[]; at: number }>();

  async function getJson(target: URL): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetcher(target.toString(), { credentials: 'omit' } as RequestInit);
    } catch (error) {
      // In a browser this is nearly always CORS on the provider.
      throw new DiscoveryError(`Could not fetch ${target} (${String(error).slice(0, 120)}).`);
    }
    if (!response.ok) throw new DiscoveryError(`${target} answered ${response.status}.`);
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new DiscoveryError(`${target} did not return JSON.`);
    }
  }

  return {
    async keys(issuerValue, keyOptions = {}) {
      const issuer = issuerValue.replace(/\/+$/, '');
      const cached = cache.get(issuer);
      if (!keyOptions.refresh && cached && now() - cached.at < ttlMs) return cached.keys;
      const discoveryUrl = requireSecureUrl(
        `${issuer}/.well-known/openid-configuration`,
        'The discovery address',
      );
      const discovery = await getJson(discoveryUrl);
      if (discovery.issuer !== issuer)
        throw new DiscoveryError(
          `The provider declares its issuer as ${String(discovery.issuer)}, not ${issuer}.`,
        );
      if (typeof discovery.jwks_uri !== 'string')
        throw new DiscoveryError('The discovery document has no jwks_uri.');
      const jwks = await getJson(requireSecureUrl(discovery.jwks_uri, 'jwks_uri'));
      const keys = Array.isArray(jwks.keys) ? (jwks.keys as Jwk[]) : [];
      cache.set(issuer, { keys, at: now() });
      return keys;
    },
  };
}

// -- tokens ---------------------------------------------------------------

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('not base64url');
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(fromBase64Url(segment)));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Reads a token's claims WITHOUT verifying it. For display and routing
 * only - never for a decision. */
export function readUnverifiedClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  return parts.length === 3 ? decodeJson(parts[1]) : null;
}

const ALGORITHMS = {
  RS256: {
    kty: 'RSA',
    importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verifyParams: { name: 'RSASSA-PKCS1-v1_5' },
  },
  PS256: {
    kty: 'RSA',
    importParams: { name: 'RSA-PSS', hash: 'SHA-256' },
    verifyParams: { name: 'RSA-PSS', saltLength: 32 },
  },
  ES256: {
    kty: 'EC',
    importParams: { name: 'ECDSA', namedCurve: 'P-256' },
    verifyParams: { name: 'ECDSA', hash: 'SHA-256' },
  },
} as const;
type Algorithm = keyof typeof ALGORITHMS;

function isAlgorithm(value: unknown): value is Algorithm {
  return value === 'RS256' || value === 'PS256' || value === 'ES256';
}

/** Keys that could have made this signature (WS14-R23): same family, not
 * marked for encryption, not pinned to another algorithm, same kid. */
function candidateKeys(keys: Jwk[], alg: Algorithm, kid: unknown): Jwk[] {
  const spec = ALGORITHMS[alg];
  return keys.filter(
    (key) =>
      key.kty === spec.kty &&
      (key.use === undefined || key.use === 'sig') &&
      (key.alg === undefined || key.alg === alg) &&
      (spec.kty !== 'EC' || key.crv === 'P-256') &&
      (typeof kid !== 'string' || key.kid === kid),
  );
}

async function signatureMatches(
  key: Jwk,
  alg: Algorithm,
  signed: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const spec = ALGORITHMS[alg];
  // Only the public fields: nothing else from a provider's JWK reaches
  // importKey, so an unexpected field cannot change how the key is used.
  const jwk =
    spec.kty === 'RSA'
      ? { kty: 'RSA', n: key.n, e: key.e, ext: true }
      : { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, ext: true };
  try {
    const imported = await globalThis.crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      spec.importParams,
      false,
      ['verify'],
    );
    return await globalThis.crypto.subtle.verify(
      spec.verifyParams,
      imported,
      signature as BufferSource,
      signed as BufferSource,
    );
  } catch {
    return false;
  }
}

// -- the whole check ------------------------------------------------------

export interface JoinEvidence {
  /** Who the store says is asking; must match the token (WS14-R24). */
  issuer: string;
  subject: string;
  /** SPKI of the user key the grant would be wrapped to. */
  publicKey: Uint8Array;
  salt: Uint8Array;
  idToken: string;
}

export type VerifyOutcome =
  | { ok: true; matchedGroup: string; claims: Record<string, unknown> }
  | { ok: false; reason: RejectionReason; message: string };

export interface VerifyJoinOptions {
  keySource: KeySource;
  /** The highest ruleVersion this browser has seen for the workspace
   * (WS14-R20). 0 when it has seen none. */
  seenRuleVersion: number;
  now?: () => number;
  /** How far in the future `iat` may be, for clock differences. */
  futureSkewSeconds?: number;
}

const reject = (reason: RejectionReason, message: string): VerifyOutcome => ({
  ok: false,
  reason,
  message,
});

/**
 * Every check in WS14-R20 to R25, in order, stopping at the first failure.
 * `rule` is the sealed rule, already decrypted; pass null when the index
 * carries none. Only an `ok: true` outcome permits a grant, and then only to
 * `evidence.publicKey` - the bytes checked here.
 */
export async function verifyJoinEvidence(
  evidence: JoinEvidence,
  rule: AccessRule | null,
  options: VerifyJoinOptions,
): Promise<VerifyOutcome> {
  // R20: the rule itself.
  if (!rule) return reject('rule-missing', 'This workspace has no automatic access rule.');
  if (rule.ruleVersion < options.seenRuleVersion)
    return reject(
      'rule-rollback',
      `The rule is version ${rule.ruleVersion}, but version ${options.seenRuleVersion} has been seen here.`,
    );
  if (!rule.enabled) return reject('rule-disabled', 'Automatic access is turned off.');

  // R23: shape and algorithm, before any key is fetched.
  const parts = evidence.idToken.split('.');
  if (parts.length !== 3) return reject('bad-signature', 'The token is not a signed JWT.');
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (!header || !claims) return reject('bad-signature', 'The token is not a well-formed JWT.');
  if (!isAlgorithm(header.alg))
    return reject('bad-alg', `Tokens signed with ${String(header.alg)} are not accepted.`);
  const alg = header.alg;
  let signature: Uint8Array;
  try {
    signature = fromBase64Url(parts[2]);
  } catch {
    return reject('bad-signature', 'The token signature is not base64url.');
  }
  if (signature.length === 0) return reject('bad-signature', 'The token is unsigned.');

  // R21: keys from the rule's issuer, one refresh for a key we do not know.
  let candidates: Jwk[];
  try {
    candidates = candidateKeys(await options.keySource.keys(rule.issuer), alg, header.kid);
    if (candidates.length === 0)
      candidates = candidateKeys(
        await options.keySource.keys(rule.issuer, { refresh: true }),
        alg,
        header.kid,
      );
  } catch (error) {
    return reject('discovery-failed', (error as Error).message);
  }
  if (candidates.length === 0)
    return reject('unknown-key', "No key in the provider's key set matches this token.");

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let verified = false;
  for (const key of candidates) {
    if (await signatureMatches(key, alg, signed, signature)) {
      verified = true;
      break;
    }
  }
  if (!verified)
    return reject('bad-signature', "The signature does not match the provider's keys.");

  // R24: whose token, for whom, and when.
  if (claims.iss !== rule.issuer)
    return reject('wrong-issuer', `The token was issued by ${String(claims.iss)}.`);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(rule.audience))
    return reject('wrong-audience', 'The token was issued to a different application.');
  if (claims.azp !== undefined && claims.azp !== rule.audience)
    return reject('wrong-audience', 'The token was authorized for a different application.');

  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat))
    return reject('too-old', 'The token does not say when it was issued.');
  if (claims.iat > nowSeconds + (options.futureSkewSeconds ?? 120))
    return reject('future-iat', 'The token claims to be issued in the future.');
  if (claims.iat < nowSeconds - rule.evidenceMaxAgeSeconds)
    return reject('too-old', 'The sign-in is too old to check. The newcomer signs in again.');
  // `exp` is deliberately not checked: ID tokens live for minutes, and a
  // join may be checked hours later. `iat` bounds the evidence instead.

  if (evidence.issuer !== rule.issuer || claims.sub !== evidence.subject)
    return reject('subject-mismatch', 'The token belongs to someone other than the person asking.');

  // R22: the token vouches for exactly the key being granted to.
  if (!(await matchesJoinCommitment(claims.nonce, evidence.publicKey, evidence.salt)))
    return reject('nonce-mismatch', 'The token does not vouch for the key it would be granted to.');

  // R25: the groups.
  const names = claims._claim_names;
  if (
    claims[rule.claim] === undefined &&
    names &&
    typeof names === 'object' &&
    rule.claim in (names as Record<string, unknown>)
  ) {
    return reject('groups-overage', 'The provider left the groups out of the token (overage).');
  }
  const groups = claims[rule.claim];
  if (Array.isArray(groups)) {
    const held = new Set(groups.filter((group): group is string => typeof group === 'string'));
    const matched = rule.groups.find((group) => held.has(group));
    if (matched) return { ok: true, matchedGroup: matched, claims };
  }
  return reject('no-group-match', 'None of the groups in the token is named by the rule.');
}

// -- rule versions seen (WS14-R20) ---------------------------------------

export interface RuleVersionStore {
  get(workspaceId: string): Promise<number>;
  /** Records a version seen; never lowers the stored one. */
  raise(workspaceId: string, ruleVersion: number): Promise<void>;
}

export function createMemoryRuleVersionStore(): RuleVersionStore {
  const seen = new Map<string, number>();
  return {
    async get(workspaceId) {
      return seen.get(workspaceId) ?? 0;
    },
    async raise(workspaceId, ruleVersion) {
      if (ruleVersion > (seen.get(workspaceId) ?? 0)) seen.set(workspaceId, ruleVersion);
    },
  };
}
