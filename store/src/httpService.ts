/**
 * The store's HTTP surface.
 *
 * Node's own `http`, with no framework: a dependency here is a dependency
 * a self-hosting team has to trust and patch.
 *
 * This file is the part every request passes through - CORS, the session,
 * the audit trail, error replies - and the routes that are about the
 * person rather than their documents:
 *
 *   GET  /v1/health
 *   GET  /v1/auth/providers
 *   GET  /v1/auth/:provider/start      begins a sign-in
 *   GET  /v1/auth/callback             where the provider sends them back
 *   GET  /v1/auth/session              who is signed in
 *   POST /v1/auth/logout
 *   POST /v1/rooms/:room/token         a relay token for a session by link
 *
 * Workspaces and documents are the workspace API, served under /v2 by the
 * handler given as `v2` (store/src/v2, docs/trusted-store.md).
 *
 * Shape of every reply:
 *
 * - Errors are `{ error: { reason, message } }` with a reason a client can
 *   branch on, never a stack trace.
 * - A reply about a document carries `X-Document-Version`.
 * - Nothing is cacheable.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { StoreError } from './documentService.ts';
import { ProviderUnreachable, type Provider } from './auth/providers.ts';
import { DirectoryError, type UserDirectory } from './userDirectory.ts';
import { mintRoomToken } from './auth/roomTokens.ts';
import { isDocumentRoom } from './v2/sessions.ts';
import {
  SESSION_COOKIE,
  expiredSessionCookie,
  parseCookies,
  serializeSessionCookie,
  type Session,
  type SessionStore,
} from './auth/sessions.ts';

export interface AuditEntry {
  at: string;
  subject: string | null;
  docId: string | null;
  operation: string;
  outcome: 'ok' | 'denied' | 'error';
  detail?: Record<string, unknown>;
}

/** The PostgreSQL implementation writes to `audit_log`; the
 * in-memory one keeps the last entries for tests. */
export interface AuditSink {
  record(entry: AuditEntry): Promise<void> | void;
}

export function createMemoryAuditSink() {
  const entries: AuditEntry[] = [];
  return {
    record(entry: AuditEntry) {
      entries.push(entry);
    },
    all(): AuditEntry[] {
      return [...entries];
    },
  };
}

/** The document operations the workspace API needs. Both implementations
 * (documentService.ts in memory, postgresStore.ts) satisfy it. */
export interface StoreBackend {
  create(request: { docId: string }): Promise<unknown>;

  append(request: {
    docId: string;
    kind: string;
    bytes: Uint8Array;
    expectedVersion?: number;
  }): Promise<{
    version: number;
  }>;

  read(
    docId: string,
    opts?: { seenVersion?: number },
  ): Promise<{
    record: { version: number };
    blobs: { meta: unknown; bytes: Uint8Array }[];
  }>;

  updatesSince(
    docId: string,
    since: number,
    opts?: { seenVersion?: number },
  ): Promise<{
    record: { version: number };
    blobs: { meta: unknown; bytes: Uint8Array }[];
  }>;

  head(
    docId: string,
    opts?: { seenVersion?: number; includeDeleted?: boolean },
  ): Promise<{ version: number }>;

  compact(
    docId: string,
    snapshot: { kind: string; bytes: Uint8Array; expectedVersion?: number },
  ): Promise<{ version: number }>;

  softDelete(docId: string): Promise<{ version: number }>;

  restore(docId: string): Promise<{ version: number }>;

  /** Administrators only, through the workspace API. */
  setLegalHold?(
    docId: string,
    hold: { reason: string; placedBy: string } | null,
  ): Promise<{ version: number }>;

  /** The retention sweep: everything past its retention and not held. */
  purgeDue?(at?: Date): Promise<string[]>;

  purge?(docId: string): Promise<void>;
}

export interface HttpServiceOptions {
  audit?: AuditSink;
  /**
   * No sign-in required. Development and tests only: a deployment that sets
   * this has no authentication at all.
   */
  allowUnauthenticated?: boolean;
  /** Sign-in providers, by id. */
  providers?: Provider[];
  sessions?: SessionStore;
  /** Where the provider sends the browser back to; also decides whether the
   * session cookie is marked Secure. A function, for a caller that only
   * knows its own address once it is listening (tests, and a deployment
   * behind a port chosen at runtime). */
  publicUrl?: string | (() => string);
  /** Where to send the browser after a completed sign-in, when the editor
   * did not say. */
  afterLoginUrl?: string;
  /** The people who have signed in. Each sign-in is recorded here, so a
   * workspace can name its members. */
  directory?: UserDirectory;
  /**
   * Shared with the relay: set on both, and the relay admits only peers
   * carrying a token this store issued; set on neither, and a room name is
   * the only thing protecting a session.
   */
  relayTokenSecret?: string | null;
  /**
   * Origins the editor may be served from. The store and the editor are
   * usually different hosts, and a session cookie only travels
   * cross-origin with an explicit allowance. Listed exactly: a wildcard is
   * not permitted alongside credentials, and would let any site spend a
   * signed-in person's session.
   */
  allowedOrigins?: string[];
  /** Refused before the body is read. */
  maxRequestBytes?: number;
  /**
   * The workspace API, served under /v2. It shares this service's
   * sessions, CORS, audit trail and error replies, and decides everything
   * else itself. Absent, /v2 answers 404.
   */
  v2?: V2Handler;
}

/** What this service hands the workspace API for one request. */
export interface V2Request {
  request: IncomingMessage;
  url: URL;
  method: string;
  /** The path after /v2, split on slashes. Segments are still URL-encoded. */
  parts: string[];
  session: Session | null;
  readJson(): Promise<Record<string, unknown>>;
  /** `version` sets the x-document-version header. */
  send(status: number, body: unknown, version?: number): void;
  record(entry: Omit<AuditEntry, 'at'>): Promise<void>;
  /** Names the operation (and document) for the audit entry written if the
   * request is refused or fails after this point. */
  describeForAudit(operation: string, docId?: string | null): void;
}

export type V2Handler = (request: V2Request) => Promise<void>;

const STATUS: Record<string, number> = {
  'not-found': 404,
  deleted: 410,
  conflict: 409,
  'stale-version': 409,
  'too-large': 413,
  quota: 507,
  'bad-request': 400,
  unsupported: 404,
  forbidden: 403,
  unauthenticated: 401,
};

export class HttpError extends Error {
  status: number;
  reason: string;

  constructor(status: number, reason: string, message: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(value: unknown, field: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'bad-request', `${field} must be a base64 string.`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new HttpError(400, 'bad-request', `${field} is not valid base64.`);
  }
  return new Uint8Array(bytes);
}

export function positiveInt(value: string | null, field: string): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(400, 'bad-request', `${field} must be a non-negative integer.`);
  }
  return parsed;
}

export function createHttpService(options: HttpServiceOptions): Server {
  const providers = new Map((options.providers ?? []).map((provider) => [provider.id, provider]));
  const sessions = options.sessions;
  if (!options.allowUnauthenticated && (providers.size === 0 || !sessions)) {
    throw new Error(
      'The store needs at least one sign-in provider and a session store. Pass allowUnauthenticated: true only for development and tests.',
    );
  }
  const publicUrl = () =>
    typeof options.publicUrl === 'function'
      ? options.publicUrl()
      : (options.publicUrl ?? 'http://127.0.0.1');
  const secureCookies = () => publicUrl().startsWith('https://');
  /** An editor on another origin cannot send a Lax cookie at all. */
  const crossSiteCookies = () =>
    (options.allowedOrigins ?? []).some((origin) => origin !== new URL(publicUrl()).origin);
  const maxRequestBytes = options.maxRequestBytes ?? 16 * 1024 * 1024;
  const audit = options.audit;

  async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > maxRequestBytes) {
      throw new HttpError(413, 'too-large', `The request body exceeds ${maxRequestBytes} bytes.`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
      total += (chunk as Buffer).length;
      if (total > maxRequestBytes) {
        throw new HttpError(413, 'too-large', `The request body exceeds ${maxRequestBytes} bytes.`);
      }
      chunks.push(chunk as Buffer);
    }
    if (total === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'bad-request', 'The request body is not valid JSON.');
    }
  }

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void handle(request, response);
  });

  /**
   * An address to send the browser to after sign-in, if it is on this store
   * or an editor origin this store allows. http(s) only, so nothing like a
   * javascript: address can be smuggled through.
   */
  function trustedReturnTo(value: string): string {
    let target: URL;
    try {
      target = new URL(value);
    } catch {
      throw new HttpError(400, 'bad-request', 'returnTo must be a full address.');
    }
    const trusted = [new URL(publicUrl()).origin, ...(options.allowedOrigins ?? [])];
    if (!['http:', 'https:'].includes(target.protocol) || !trusted.includes(target.origin)) {
      throw new HttpError(
        400,
        'bad-request',
        `This store does not send people to ${target.origin} after they sign in. Add it to ALLOWED_ORIGINS if it is an editor for this store.`,
      );
    }
    return target.toString();
  }

  /** Set once per request, so every reply carries it - errors and
   * redirects included, or a cross-origin editor sees an opaque failure. */
  function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin;
    if (!origin || !(options.allowedOrigins ?? []).includes(origin)) return false;
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-credentials', 'true');
    response.setHeader('access-control-expose-headers', 'x-document-version');
    response.setHeader('vary', 'origin');
    return true;
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://store.local');
    // Nothing this API returns may be reused by a browser or a proxy: every
    // answer depends on who is asking and on state that changes. Without
    // this a browser may keep an error - "that document is deleted" - and
    // go on giving it after the document has been restored. It also keeps
    // documents out of shared caches.
    response.setHeader('cache-control', 'no-store');
    applyCors(request, response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      return response.end();
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const method = request.method ?? 'GET';
    const session =
      (await sessions?.get(parseCookies(request.headers.cookie)[SESSION_COOKIE] ?? null)) ?? null;
    const subject = session
      ? `${session.issuer}#${session.subject}`
      : options.allowUnauthenticated
        ? 'anonymous'
        : null;
    // What the audit entry says if the request is refused or fails.
    let docId: string | null = null;
    let operation = `${method} ${url.pathname}`;

    try {
      if (parts.length === 0 && method === 'GET') {
        // Someone has opened the store in a browser - usually by following
        // a sign-in that had nowhere to return to. Say what this is and
        // where the editor is, rather than answering "No route for /".
        return send(response, 200, {
          service: 'system-design store',
          workspaces: '/v2/workspaces',
          health: '/v1/health',
          signIn: [...providers.keys()].map((provider) => `/v1/auth/${provider}/start`),
          editor: options.afterLoginUrl ?? null,
          note: 'This is the storage service, not the editor.',
        });
      }

      if (parts[0] === 'v2' && options.v2) {
        return await options.v2({
          request,
          url,
          method,
          parts: parts.slice(1),
          session,
          readJson: () => readJson(request),
          send: (status, body, version) => send(response, status, body, version),
          record,
          describeForAudit(name, id) {
            operation = name;
            if (id !== undefined) docId = id;
          },
        });
      }

      if (parts[0] !== 'v1')
        throw new HttpError(404, 'unsupported', `No route for ${url.pathname}.`);

      if (parts[1] === 'health' && method === 'GET') {
        return send(response, 200, {
          status: 'ok',
          authentication: options.allowUnauthenticated ? 'none' : 'required',
          // So a client knows whether to ask for a token before joining a
          // session.
          relayAuthentication: options.relayTokenSecret ? 'required' : 'none',
        });
      }

      if (parts[1] === 'auth') {
        return await handleAuth(parts, method, url, response, session);
      }

      // Everything below needs someone signed in.
      if (!session && !options.allowUnauthenticated) {
        await record({
          operation,
          outcome: 'denied',
          subject: null,
          docId: null,
          detail: { reason: 'unauthenticated' },
        });
        return send(response, 401, {
          error: { reason: 'unauthenticated', message: 'Sign in to use this store.' },
        });
      }

      if (parts[1] === 'rooms' && parts[3] === 'token' && method === 'POST') {
        // A token for one room, for someone this store has identified: a
        // session people start themselves and share by link. It admits the
        // holder to the relay and opens no document - what passes through
        // the relay is encrypted with the key in the link, which reaches
        // neither service.
        if (!options.relayTokenSecret) {
          throw new HttpError(
            404,
            'unsupported',
            "This deployment's relay does not require tokens.",
          );
        }
        const room = decodeURIComponent(parts[2] ?? '');
        if (!room) throw new HttpError(400, 'bad-request', 'Name the room.');
        // A workspace document's room is given out with the document, to
        // people who may edit it (/v2/documents/:id/session). Handing a
        // token for one to anyone signed in would let a person who has
        // been removed, but remembers the room, back into it.
        if (isDocumentRoom(room)) {
          throw new HttpError(
            403,
            'forbidden',
            'That room belongs to a workspace document. Open the document to join its session.',
          );
        }
        const minted = mintRoomToken({
          room,
          subject: subject ?? 'anonymous',
          secret: options.relayTokenSecret,
        });
        operation = 'room-token';
        await record({ operation, outcome: 'ok', subject, docId: null, detail: { room } });
        return send(response, 200, {
          token: minted.token,
          expiresAt: new Date(minted.expiresAt).toISOString(),
        });
      }

      throw new HttpError(404, 'unsupported', `No route for ${url.pathname}.`);
    } catch (error) {
      const { status, reason, message } = describe(error);
      await record({
        operation,
        outcome: status >= 500 ? 'error' : 'denied',
        subject,
        docId,
        detail: { reason, status },
      });
      return send(response, status, { error: { reason, message } });
    }
  }

  /**
   * /v1/auth/providers, /v1/auth/:provider/start, /v1/auth/callback,
   * /v1/auth/session, /v1/auth/logout.
   */
  async function handleAuth(
    parts: string[],
    method: string,
    url: URL,
    response: ServerResponse,
    session: Session | null,
  ) {
    if (parts[2] === 'providers' && method === 'GET') {
      return send(response, 200, {
        providers: [...providers.keys()],
      });
    }

    if (parts[2] === 'session' && method === 'GET') {
      if (!session)
        return send(response, 401, {
          error: { reason: 'unauthenticated', message: 'Not signed in.' },
        });
      return send(response, 200, {
        session: {
          issuer: session.issuer,
          subject: session.subject,
          displayName: session.displayName,
          expiresAt: session.expiresAt,
          // True when the provider had more groups for this person than it
          // would send, so group-based roles may be missing.
          groupsOverage: session.groupsOverage ?? false,
        },
      });
    }

    if (parts[2] === 'logout' && method === 'POST') {
      if (session) await sessions?.destroy(session.id);
      await record({
        operation: 'logout',
        outcome: 'ok',
        subject: session ? `${session.issuer}#${session.subject}` : null,
        docId: null,
      });
      response.writeHead(204, {
        'set-cookie': expiredSessionCookie(secureCookies(), crossSiteCookies()),
      });
      return response.end();
    }

    if (parts[3] === 'start' && method === 'GET') {
      const provider = providers.get(parts[2]);
      if (!provider || !sessions)
        throw new HttpError(404, 'unsupported', `No sign-in provider named ${parts[2]}.`);
      // Where to come back to. An editor on any trusted origin may name its
      // own page, so that someone who signs in from one editor is not
      // dropped in another, and returns to the document they had open.
      // Anywhere else is refused outright: quietly falling back would hide
      // a misconfiguration, and following it would be an open redirect.
      const rawReturnTo = url.searchParams.get('returnTo');
      const returnTo = rawReturnTo !== null ? trustedReturnTo(rawReturnTo) : undefined;
      const { url: authorizeUrl, pending } = await provider.begin(
        `${publicUrl()}/v1/auth/callback`,
      );
      await sessions.remember(returnTo !== undefined ? { ...pending, returnTo } : pending);
      await record({
        operation: 'login-start',
        outcome: 'ok',
        subject: null,
        docId: null,
        detail: { provider: provider.id },
      });
      response.writeHead(302, { location: authorizeUrl });
      return response.end();
    }

    if (parts[2] === 'callback' && method === 'GET') {
      if (!sessions) throw new HttpError(404, 'unsupported', 'No sign-in is configured.');
      const error = url.searchParams.get('error');
      if (error) {
        await record({
          operation: 'login',
          outcome: 'denied',
          subject: null,
          docId: null,
          detail: { error },
        });
        throw new HttpError(400, 'bad-request', `The provider reported: ${error}`);
      }
      // Single-use, and unknown after ten minutes: a callback without a
      // pending sign-in is a replay or a forgery, not a login.
      const pending = await sessions.take(url.searchParams.get('state'));
      if (!pending) {
        await record({
          operation: 'login',
          outcome: 'denied',
          subject: null,
          docId: null,
          detail: { reason: 'unknown-state' },
        });
        throw new HttpError(
          400,
          'bad-request',
          'This sign-in did not start here, or it has expired. Try again.',
        );
      }
      const provider = providers.get(pending.provider);
      const code = url.searchParams.get('code');
      if (!provider || !code)
        throw new HttpError(400, 'bad-request', 'The provider returned no authorization code.');

      let identity;
      try {
        identity = await provider.complete(code, pending);
      } catch (failure) {
        await record({
          operation: 'login',
          outcome: 'denied',
          subject: null,
          docId: null,
          detail: { provider: provider.id, message: String(failure).slice(0, 200) },
        });
        throw new HttpError(401, 'unauthenticated', 'Sign-in failed. Please try again.');
      }
      const created = await sessions.create(identity);
      // Resolved once, here, rather than on every request.
      if (options.directory) {
        const user = await options.directory.upsertUser(identity);
        created.userId = user.userId;
        await sessions.setUserId(created.id, user.userId);
      }
      await record({
        operation: 'login',
        outcome: 'ok',
        subject: `${identity.issuer}#${identity.subject}`,
        docId: null,
        // Group names are not logged.
        detail: {
          provider: provider.id,
          ...(identity.groupsOverage ? { groupsOverage: true } : {}),
        },
      });
      response.writeHead(302, {
        location: pending.returnTo ?? options.afterLoginUrl ?? '/',
        'set-cookie': serializeSessionCookie(created.id, {
          secure: secureCookies(),
          crossSite: crossSiteCookies(),
          maxAgeSeconds: Math.max(1, Math.floor((created.expiresAt - Date.now()) / 1000)),
        }),
      });
      return response.end();
    }

    throw new HttpError(404, 'unsupported', `No route for ${url.pathname}.`);
  }

  function describe(error: unknown): { status: number; reason: string; message: string } {
    if (error instanceof HttpError)
      return { status: error.status, reason: error.reason, message: error.message };
    if (error instanceof StoreError || error instanceof DirectoryError)
      return {
        status: STATUS[error.reason] ?? 500,
        reason: error.reason,
        message: error.message,
      };
    if (error instanceof ProviderUnreachable) {
      return { status: 502, reason: 'provider-unreachable', message: error.message };
    }
    console.error('[store] unhandled error:', error);
    return { status: 500, reason: 'internal', message: 'The store failed to handle this request.' };
  }

  async function record(entry: Omit<AuditEntry, 'at'>) {
    await audit?.record({ at: new Date().toISOString(), ...entry });
  }
}

export function positiveIntHeader(request: IncomingMessage, header: string): number | undefined {
  const raw = request.headers[header];
  if (typeof raw !== 'string') return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(400, 'bad-request', `${header} must be a non-negative integer.`);
  }
  return parsed;
}

function send(response: ServerResponse, status: number, body: unknown, version?: number) {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
    // WS8-R15: every document response says which version it is.
    ...(version !== undefined ? { 'x-document-version': String(version) } : {}),
  };
  response.writeHead(status, headers);
  response.end(payload);
}
