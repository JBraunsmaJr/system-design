/**
 * Sign-in providers (WS10-R1, OQ-18).
 *
 * Generic OIDC is the mechanism: configured by issuer URL and discovery, so
 * Keycloak - the expected deployment - Entra ID, Okta, Auth0, GitLab, and
 * Google all work with no provider-specific code. GitHub needs the one
 * adapter below, being OAuth2 without OIDC: no discovery document, no ID
 * token, so identity comes from its user endpoint.
 *
 * The store is the OAuth client throughout: the secret stays here, and the
 * browser only ever holds a session cookie (sessions.ts). A subject is
 * `(issuer, subject)`, never an email address - emails change hands.
 */
import { randomBytes, createHash } from 'crypto';
import { verifyIdToken, type JsonWebKey } from './jwt.ts';

export interface ProviderConfig {
  /** As named in AUTH_PROVIDERS. */
  id: string;
  kind: 'oidc' | 'github';
  clientId: string;
  clientSecret: string;
  /**
   * OIDC only: the issuer as the BROWSER sees it, and as tokens claim it.
   */
  issuer?: string;
  /**
   * Where this server reaches the provider, when that is a different
   * address from the browser's - a container network, typically, where
   * the browser knows http://localhost:8081 and the store knows
   * http://keycloak:8080. Only back-channel calls use it: discovery, the
   * token exchange, the key set. The browser is always sent to the public
   * address, and tokens are still checked against the public issuer.
   */
  internalUrl?: string;
  /** GitHub only, to point tests and GitHub Enterprise elsewhere. */
  authorizeUrl?: string;
  tokenUrl?: string;
  userUrl?: string;
  scopes?: string[];
  /** OIDC only: the ID-token claim holding groups (WS14-R6). Default `groups`. */
  groupsClaim?: string;
}

export interface Identity {
  issuer: string;
  subject: string;
  displayName?: string;
  /** WS14-R6: the groups the verified ID token carried. OIDC only. */
  groups?: string[];
  /** WS14-R6: the provider left groups out of the token (Entra overage). */
  groupsOverage?: boolean;
  /**
   * WS14-R4: present only when the sign-in carried a key commitment. The
   * raw token is kept so a member's browser can check the provider's own
   * signature later, rather than taking the store's word for anything.
   */
  evidence?: JoinEvidenceRecord;
}

export interface JoinEvidenceRecord {
  idToken: string;
  commitment: string;
  /** Seconds since the epoch, from the token. */
  iat: number;
}

/** What a sign-in needs to remember between the redirect out and back. */
export interface PendingLogin {
  provider: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
  /** WS14-R3: the nonce is a key commitment the browser supplied, so the
   * token is kept as evidence when the sign-in completes. */
  hasCommitment?: boolean;
}

export interface Provider {
  id: string;
  /** Where to send the browser, plus what to remember. Async because an
   * OIDC provider's authorization endpoint comes from discovery: guessing it
   * from the issuer is wrong for Keycloak, among others. */
  begin(
    redirectUri: string,
    options?: { commitment?: string },
  ): Promise<{ url: string; pending: PendingLogin }>;
  /** Exchanges the code and returns who signed in. */
  complete(code: string, pending: PendingLogin): Promise<Identity>;
  /** What the editor needs to pre-fill an access rule (WS14-R12). */
  describe(): { kind: 'oidc' | 'github'; issuer?: string; clientId: string };
}

/** WS14-R7: only OIDC produces a signed token a member can check. */
export class CommitmentUnsupported extends Error {
  constructor(provider: string) {
    super(`Automatic access needs an ID token, which ${provider} sign-in does not provide.`);
    this.name = 'CommitmentUnsupported';
  }
}

const base64url = (bytes: Buffer) => bytes.toString('base64url');
const randomToken = () => base64url(randomBytes(32));

export type Fetcher = typeof fetch;

/** The provider could not be reached at all, as distinct from refusing
 * something. Worth its own type: it is nearly always configuration. */
export class ProviderUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnreachable';
  }
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/**
 * Generic OIDC with Authorization Code + PKCE. PKCE matters even with a
 * client secret: it binds the code to the browser that started the sign-in,
 * so a code intercepted in the redirect is useless elsewhere.
 */
export function createOidcProvider(config: ProviderConfig, fetcher: Fetcher = fetch): Provider {
  if (!config.issuer) throw new Error(`Provider ${config.id} needs an issuer URL.`);
  const issuer = config.issuer.replace(/\/+$/, '');
  const internalBase = config.internalUrl?.replace(/\/+$/, '') ?? null;

  /**
   * A provider's own endpoints come back as public URLs, which this server
   * may not be able to reach. Back-channel calls are sent to the internal
   * address instead, keeping the path. The authorization endpoint is left
   * alone: that one is for the browser.
   */
  const backChannel = (endpoint: string): string => {
    if (!internalBase) return endpoint;
    const target = new URL(endpoint);
    const publicOrigin = new URL(issuer).origin;
    if (target.origin !== publicOrigin) return endpoint;
    return `${internalBase}${target.pathname}${target.search}`;
  };
  let discovered: Discovery | null = null;
  let keys: JsonWebKey[] = [];

  async function discover(): Promise<Discovery> {
    if (discovered) return discovered;
    // The issuer's path, if it has one (a Keycloak realm does), joined
    // without leaving a double slash when it does not.
    const issuerPath = new URL(issuer).pathname.replace(/\/+$/, '');
    const discoveryUrl = internalBase
      ? `${internalBase}${issuerPath}/.well-known/openid-configuration`
      : `${issuer}/.well-known/openid-configuration`;
    let response: Response;
    try {
      response = await fetcher(discoveryUrl);
    } catch (error) {
      throw new ProviderUnreachable(
        `The store could not reach the identity provider at ${discoveryUrl}. ` +
          (internalBase
            ? 'Check OIDC_INTERNAL_URL: it is the address this server uses, which in a container network is usually the service name, not localhost.'
            : 'Check OIDC_ISSUER, and whether this server can reach it - inside a container, localhost is the container itself.') +
          ` (${String((error as Error).cause ?? error).slice(0, 120)})`,
      );
    }
    if (!response.ok) throw new Error(`Discovery failed for ${discoveryUrl}: ${response.status}`);
    const document = (await response.json()) as Discovery;
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      if (typeof document[field] !== 'string')
        throw new Error(`Discovery for ${issuer} has no ${field}.`);
    }
    if (document.issuer !== issuer) {
      throw new Error(
        `The provider declares its issuer as ${document.issuer}, but this store is configured with ${issuer}. ` +
          `They must match exactly - tokens carry the provider's value. Where the browser and this server reach the provider ` +
          `at different addresses, set OIDC_ISSUER to the browser's and OIDC_INTERNAL_URL to this server's, and configure the ` +
          `provider with its public address (for Keycloak, KC_HOSTNAME).`,
      );
    }
    discovered = document;
    return document;
  }

  async function jwks(): Promise<JsonWebKey[]> {
    // Refetched when a token names a key we do not have: providers rotate.
    const document = await discover();
    const response = await fetcher(backChannel(document.jwks_uri));
    if (!response.ok) throw new Error(`Could not fetch the provider's keys: ${response.status}`);
    keys = ((await response.json()) as { keys?: JsonWebKey[] }).keys ?? [];
    return keys;
  }

  return {
    id: config.id,

    describe() {
      return { kind: 'oidc' as const, issuer, clientId: config.clientId };
    },

    async begin(redirectUri, beginOptions = {}) {
      const document = await discover();
      // WS14-R3: a key commitment from the browser becomes the nonce, so the
      // provider signs it into the token. Validated by the caller; checked
      // again here because this is where it turns into a signed claim.
      const commitment = beginOptions.commitment;
      if (commitment !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(commitment))
        throw new Error('A key commitment must be 43 base64url characters.');
      const pending: PendingLogin = {
        provider: config.id,
        state: randomToken(),
        nonce: commitment ?? randomToken(),
        codeVerifier: randomToken(),
        redirectUri,
        createdAt: Date.now(),
        hasCommitment: commitment !== undefined,
      };
      const challenge = base64url(createHash('sha256').update(pending.codeVerifier).digest());
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: (config.scopes ?? ['openid', 'profile']).join(' '),
        state: pending.state,
        nonce: pending.nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return { url: `${document.authorization_endpoint}?${query}`, pending };
    },

    async complete(code, pending) {
      const document = await discover();
      const response = await fetcher(backChannel(document.token_endpoint), {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: pending.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code_verifier: pending.codeVerifier,
        }),
      });
      if (!response.ok)
        throw new Error(`The provider refused the code exchange (${response.status}).`);
      const token = (await response.json()) as { id_token?: string };
      if (!token.id_token) throw new Error('The provider returned no ID token.');
      let claims;
      try {
        claims = verifyIdToken(token.id_token, {
          issuer,
          audience: config.clientId,
          nonce: pending.nonce,
          keys: keys.length ? keys : await jwks(),
        });
      } catch {
        // One retry with fresh keys, for a provider that has rotated.
        claims = verifyIdToken(token.id_token, {
          issuer,
          audience: config.clientId,
          nonce: pending.nonce,
          keys: await jwks(),
        });
      }
      // WS14-R6: groups, from the verified token only.
      const all = claims as unknown as Record<string, unknown>;
      const groupsClaim = config.groupsClaim ?? 'groups';
      const rawGroups = all[groupsClaim];
      const claimNames = all._claim_names;
      const groupsOverage =
        rawGroups === undefined &&
        !!claimNames &&
        typeof claimNames === 'object' &&
        groupsClaim in (claimNames as Record<string, unknown>);
      return {
        issuer,
        subject: claims.sub,
        displayName: claims.name ?? claims.preferred_username ?? undefined,
        groups: Array.isArray(rawGroups)
          ? rawGroups.filter((group): group is string => typeof group === 'string')
          : [],
        groupsOverage,
        // WS14-R4: kept only for a sign-in that committed to a key.
        ...(pending.hasCommitment && typeof claims.iat === 'number'
          ? { evidence: { idToken: token.id_token, commitment: pending.nonce, iat: claims.iat } }
          : {}),
      };
    },
  };
}

/**
 * GitHub: OAuth2 without OIDC. There is no discovery and no ID token, so
 * identity comes from the user endpoint, and the subject is the numeric
 * account id - the login name can be changed and reused.
 */
export function createGitHubProvider(config: ProviderConfig, fetcher: Fetcher = fetch): Provider {
  const authorizeUrl = config.authorizeUrl ?? 'https://github.com/login/oauth/authorize';
  const tokenUrl = config.tokenUrl ?? 'https://github.com/login/oauth/access_token';
  const userUrl = config.userUrl ?? 'https://api.github.com/user';
  const issuer = new URL(authorizeUrl).origin;

  return {
    id: config.id,

    describe() {
      return { kind: 'github' as const, clientId: config.clientId };
    },

    async begin(redirectUri, beginOptions = {}) {
      if (beginOptions.commitment !== undefined) throw new CommitmentUnsupported('GitHub');
      const pending: PendingLogin = {
        provider: config.id,
        state: randomToken(),
        nonce: '',
        codeVerifier: '',
        redirectUri,
        createdAt: Date.now(),
      };
      const query = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: (config.scopes ?? ['read:user']).join(' '),
        state: pending.state,
      });
      return { url: `${authorizeUrl}?${query}`, pending };
    },

    async complete(code, pending) {
      const response = await fetcher(tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: pending.redirectUri,
        }),
      });
      if (!response.ok) throw new Error(`GitHub refused the code exchange (${response.status}).`);
      const token = (await response.json()) as { access_token?: string; error?: string };
      if (!token.access_token)
        throw new Error(
          `GitHub returned no access token${token.error ? ` (${token.error})` : ''}.`,
        );
      const user = await fetcher(userUrl, {
        headers: {
          authorization: `Bearer ${token.access_token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'system-design-store',
        },
      });
      if (!user.ok) throw new Error(`Could not read the GitHub account (${user.status}).`);
      const account = (await user.json()) as { id?: number; login?: string; name?: string };
      if (typeof account.id !== 'number')
        throw new Error('GitHub returned an account without an id.');
      return { issuer, subject: String(account.id), displayName: account.name ?? account.login };
    },
  };
}

export function createProvider(config: ProviderConfig, fetcher: Fetcher = fetch): Provider {
  return config.kind === 'github'
    ? createGitHubProvider(config, fetcher)
    : createOidcProvider(config, fetcher);
}
