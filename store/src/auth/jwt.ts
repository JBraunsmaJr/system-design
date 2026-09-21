/**
 * Verifying an OIDC ID token (WS10-R1).
 *
 * Only what an ID token needs: RS256, a JWKS fetched from the provider, and
 * the claims that decide whether a token is ours - issuer, audience, expiry,
 * and the nonce that ties it to the sign-in this browser started. Written out
 * rather than pulled in, because a dependency here is one a self-hosting team
 * has to trust and patch, and the surface is small.
 *
 * Deliberately strict: an unsigned token (`alg: none`), a token signed with a
 * key that is not in the provider's JWKS, or one whose `kid` does not match
 * is rejected. Those are the mistakes that turn authentication into theatre.
 */
import { createPublicKey, verify as verifySignature } from 'crypto';

export interface JsonWebKey {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

export class TokenError extends Error {
  reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = 'TokenError';
    this.reason = reason;
  }
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    throw new TokenError('The token is not a well-formed JWT.', 'malformed');
  }
}

export interface VerifyOptions {
  issuer: string;
  audience: string;
  nonce?: string;
  keys: JsonWebKey[];
  /** Injected so tests can be deterministic. */
  now?: () => number;
  /** Tolerance for clock differences between the provider and this host. */
  clockSkewSeconds?: number;
}

export function verifyIdToken(token: string, options: VerifyOptions): IdTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('The token is not a well-formed JWT.', 'malformed');
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeSegment(headerSegment) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') {
    // Including "none": a token that says it needs no signature is not a token.
    throw new TokenError(
      `Unsupported token algorithm ${header.alg ?? '(absent)'}; RS256 is required.`,
      'algorithm',
    );
  }

  const candidates = options.keys.filter(
    (key) => key.kty === 'RSA' && (!header.kid || !key.kid || key.kid === header.kid),
  );
  if (candidates.length === 0)
    throw new TokenError("No key in the provider's JWKS matches this token.", 'unknown-key');

  const signed = Buffer.from(`${headerSegment}.${payloadSegment}`);
  const signature = Buffer.from(signatureSegment, 'base64url');
  const signedByProvider = candidates.some((key) => {
    try {
      return verifySignature(
        'RSA-SHA256',
        signed,
        createPublicKey({ key: key as never, format: 'jwk' }),
        signature,
      );
    } catch {
      return false;
    }
  });
  if (!signedByProvider)
    throw new TokenError("The token's signature does not match the provider's keys.", 'signature');

  const claims = decodeSegment(payloadSegment) as unknown as IdTokenClaims;
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const skew = options.clockSkewSeconds ?? 60;

  if (claims.iss !== options.issuer) {
    throw new TokenError(`The token was issued by ${claims.iss}, not ${options.issuer}.`, 'issuer');
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.audience)) {
    throw new TokenError('The token was issued for a different application.', 'audience');
  }
  if (typeof claims.exp !== 'number' || claims.exp + skew < now)
    throw new TokenError('The token has expired.', 'expired');
  if (typeof claims.iat === 'number' && claims.iat - skew > now)
    throw new TokenError('The token is not valid yet.', 'issued-in-future');
  if (options.nonce !== undefined && claims.nonce !== options.nonce) {
    // Ties the token to the sign-in this browser started: without it, a token
    // captured elsewhere could be replayed here.
    throw new TokenError('The token does not belong to this sign-in.', 'nonce');
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0)
    throw new TokenError('The token carries no subject.', 'subject');
  return claims;
}
