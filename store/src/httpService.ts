/**
 * The store's HTTP surface (WS8-R2).
 *
 * Node's own `http`, with no framework: the surface is a dozen routes of
 * JSON, and a dependency here is a dependency a self-hosting team has to
 * trust and patch.
 *
 * Shape of the API:
 *
 * - Blob bodies travel base64-encoded inside JSON. The store never looks at
 *   them (WS8-R1), and base64 keeps one content type across every route.
 * - Every response that concerns a document carries `X-Document-Version`
 *   (WS8-R15). A client sends back the highest version it has seen as
 *   `If-Document-Version`; a response older than that is refused with 409
 *   rather than served, which is how a rolled-back store is caught.
 * - Errors are `{ error: { reason, message } }` with a reason a client can
 *   branch on, never a stack trace.
 *
 * Authentication is not here yet (that is the next step). Until it lands the
 * service requires an explicit `--insecure-no-auth` style flag from its
 * caller, so a deployment cannot start one unauthenticated by accident.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { StoreError } from "./documentService.ts";
import type { Provider } from "./auth/providers.ts";
import { DirectoryError, verificationCodeFor, type UserDirectory } from "./userDirectory.ts";
import {
  SESSION_COOKIE,
  expiredSessionCookie,
  parseCookies,
  serializeSessionCookie,
  type Session,
  type SessionStore,
} from "./auth/sessions.ts";

export interface AuditEntry {
  at: string;
  subject: string | null;
  docId: string | null;
  operation: string;
  outcome: "ok" | "denied" | "error";
  detail?: Record<string, unknown>;
}

/** WS10-R3. The PostgreSQL implementation writes to `audit_log`; the
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

/** The store operations the HTTP layer needs. Both implementations satisfy
 * it, so the same routes run over either. */
export interface StoreBackend {
  create(request: { docId: string; keys: { wrappedForWorkspace: string; wrappedForRecovery?: string } }): Promise<unknown>;
  append(request: { docId: string; kind: string; bytes: Uint8Array; expectedVersion?: number }): Promise<{ version: number }>;
  read(docId: string, opts?: { seenVersion?: number }): Promise<{ record: { version: number }; blobs: { meta: unknown; bytes: Uint8Array }[] }>;
  updatesSince(docId: string, since: number, opts?: { seenVersion?: number }): Promise<{ record: { version: number }; blobs: { meta: unknown; bytes: Uint8Array }[] }>;
  head(docId: string, opts?: { seenVersion?: number; includeDeleted?: boolean }): Promise<{ version: number }>;
  list(opts?: { includeDeleted?: boolean }): Promise<unknown[]>;
  compact(docId: string, snapshot: { kind: string; bytes: Uint8Array }): Promise<{ version: number }>;
  softDelete(docId: string): Promise<{ version: number }>;
  restore(docId: string): Promise<{ version: number }>;
  getMeta(docId: string, opts?: { seenVersion?: number }): Promise<Uint8Array | null>;
  /** WS10-R8, WS10-R4: administrators only, through the routes below. */
  setLegalHold?(docId: string, hold: { reason: string; placedBy: string } | null): Promise<{ version: number }>;
  purgeDue?(at?: Date): Promise<string[]>;
  purge?(docId: string): Promise<void>;
  setMeta(docId: string, sealed: Uint8Array): Promise<{ version: number }>;
}

export interface HttpServiceOptions {
  store: StoreBackend;
  audit?: AuditSink;
  /**
   * No sign-in required. Development and tests only: a deployment that sets
   * this has no authentication at all (WS10-R1).
   */
  allowUnauthenticated?: boolean;
  /** Sign-in providers, by id (WS10-R1). */
  providers?: Provider[];
  sessions?: SessionStore;
  /** Where the provider sends the browser back to; also decides whether the
   * session cookie is marked Secure. A function, for a caller that only
   * knows its own address once it is listening (tests, and a deployment
   * behind a port chosen at runtime). */
  publicUrl?: string | (() => string);
  /** Where to send the browser after a completed sign-in. */
  afterLoginUrl?: string;
  /** Users, devices, and wrapped keys (WS7-R8, R11, R12, R14). */
  directory?: UserDirectory;
  /**
   * Who may place holds, purge, and see every document (WS10-R2). Given the
   * signed-in subject as `issuer#subject`. Absent means nobody: a store with
   * no administrators configured refuses these routes rather than allowing
   * them to everyone.
   */
  isAdmin?: (subject: string) => boolean;
  /** WS8-R8: refused before the body is read. */
  maxRequestBytes?: number;
}

const STATUS: Record<string, number> = {
  "not-found": 404,
  deleted: 410,
  conflict: 409,
  "stale-version": 409,
  "too-large": 413,
  quota: 507,
  "bad-request": 400,
  unsupported: 404,
  "too-many-bytes": 413,
  forbidden: 403,
  revoked: 403,
  "not-approved": 403,
  unauthenticated: 401,
};

class HttpError extends Error {
  status: number;
  reason: string;

  constructor(status: number, reason: string, message: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: unknown, field: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "bad-request", `${field} must be a base64 string.`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new HttpError(400, "bad-request", `${field} is not valid base64.`);
  }
  return new Uint8Array(bytes);
}

function positiveInt(value: string | null, field: string): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "bad-request", `${field} must be a non-negative integer.`);
  }
  return parsed;
}

export function createHttpService(options: HttpServiceOptions): Server {
  const providers = new Map((options.providers ?? []).map((provider) => [provider.id, provider]));
  const sessions = options.sessions;
  if (!options.allowUnauthenticated && (providers.size === 0 || !sessions)) {
    throw new Error(
      "The store needs at least one sign-in provider and a session store. Pass allowUnauthenticated: true only for development and tests (WS10-R1).",
    );
  }
  const publicUrl = () => (typeof options.publicUrl === "function" ? options.publicUrl() : options.publicUrl ?? "http://127.0.0.1");
  const secureCookies = () => publicUrl().startsWith("https://");
  const maxRequestBytes = options.maxRequestBytes ?? 16 * 1024 * 1024;
  const audit = options.audit;

  async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const declared = Number(request.headers["content-length"] ?? 0);
    if (declared > maxRequestBytes) {
      throw new HttpError(413, "too-large", `The request body exceeds ${maxRequestBytes} bytes.`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
      total += (chunk as Buffer).length;
      if (total > maxRequestBytes) {
        throw new HttpError(413, "too-large", `The request body exceeds ${maxRequestBytes} bytes.`);
      }
      chunks.push(chunk as Buffer);
    }
    if (total === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "bad-request", "The request body is not valid JSON.");
    }
  }

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://store.local");
    const parts = url.pathname.split("/").filter(Boolean);
    const method = request.method ?? "GET";
    // Replaced by the authenticated subject in the next step; until then it
    // is only ever a label in the audit trail.
    const session = sessions?.get(parseCookies(request.headers.cookie)[SESSION_COOKIE] ?? null) ?? null;
    const subject = session ? `${session.issuer}#${session.subject}` : options.allowUnauthenticated ? "anonymous" : null;
    let docId: string | null = null;
    let operation = `${method} ${url.pathname}`;

    try {
      // Inside the try: a malformed header is a 400 like any other bad input.
      const seenVersion = positiveIntHeader(request, "if-document-version");
      if (parts[0] !== "v1") throw new HttpError(404, "unsupported", `No route for ${url.pathname}.`);

      if (parts[1] === "health" && method === "GET") {
        return send(response, 200, { status: "ok" });
      }

      if (parts[1] === "auth") {
        return await handleAuth(parts, method, url, response, session);
      }

      // Everything below needs a signed-in subject (WS10-R1). Signing in
      // proves identity only; it gives no access to document content, which
      // still needs an approved device (WS7-R11).
      if (!session && !options.allowUnauthenticated) {
        await record({ operation, outcome: "denied", subject: null, docId: null, detail: { reason: "unauthenticated" } });
        return send(response, 401, { error: { reason: "unauthenticated", message: "Sign in to use this store." } });
      }

      if (parts[1] === "admin") {
        requireAdmin(subject);
        // WS7-R13: an administrator restoring access for someone who has
        // lost every device and their recovery code.
        if (parts[2] === "users" && !parts[3] && method === "GET") {
          if (!options.directory) throw new HttpError(404, "unsupported", "This store has no user directory configured.");
          return send(response, 200, { users: await options.directory.listUsers() });
        }
        if (parts[2] === "users" && parts[3] && parts[4] === "regrant" && method === "POST") {
          if (!options.directory) throw new HttpError(404, "unsupported", "This store has no user directory configured.");
          operation = "user-regrant";
          const user = await options.directory.regrantUser(decodeURIComponent(parts[3]));
          await record({ operation, outcome: "ok", subject, docId: null, detail: { userId: user.userId } });
          // Their next device enrolls as a first device, and the
          // administrator wraps the workspace key to its new user key below.
          return send(response, 200, { user });
        }
        if (parts[2] === "users" && parts[3] && parts[4] === "workspace-key" && method === "PUT") {
          if (!options.directory) throw new HttpError(404, "unsupported", "This store has no user directory configured.");
          const body = await readJson(request);
          const userId = decodeURIComponent(parts[3]);
          const generation = typeof body.generation === "number" ? body.generation : 1;
          await options.directory.putWorkspaceKey(userId, generation, requireString(body.wrappedKey, "wrappedKey"));
          operation = "workspace-key-grant";
          await record({ operation, outcome: "ok", subject, docId: null, detail: { userId, generation } });
          return send(response, 204, {});
        }
        if (parts[2] === "purge-due" && method === "POST") {
          if (!options.store.purgeDue) throw new HttpError(404, "unsupported", "This store does not support purging.");
          operation = "purge-due";
          // The sweep an operator or a timer runs: everything past its
          // retention and not under hold (WS10-R4).
          const purged = await options.store.purgeDue();
          await record({ operation, outcome: "ok", subject, docId: null, detail: { count: purged.length } });
          return send(response, 200, { purged });
        }
        throw new HttpError(404, "unsupported", `No route for ${url.pathname}.`);
      }

      if (parts[1] === "users") {
        return await handleUsers(parts, method, request, response, session);
      }

      if (parts[1] !== "docs") throw new HttpError(404, "unsupported", `No route for ${url.pathname}.`);

      // /v1/docs
      if (parts.length === 2) {
        if (method === "GET") {
          operation = "list";
          const includeDeleted = url.searchParams.get("includeDeleted") === "true";
          const documents = await options.store.list({ includeDeleted });
          await record({ operation, outcome: "ok", subject, docId: null });
          return send(response, 200, { documents });
        }
        if (method === "POST") {
          operation = "create";
          const body = await readJson(request);
          docId = requireString(body.docId, "docId");
          const keys = body.keys as { wrappedForWorkspace?: unknown; wrappedForRecovery?: unknown } | undefined;
          if (!keys || typeof keys.wrappedForWorkspace !== "string") {
            throw new HttpError(400, "bad-request", "keys.wrappedForWorkspace is required.");
          }
          const created = await options.store.create({
            docId,
            keys: {
              wrappedForWorkspace: keys.wrappedForWorkspace,
              ...(typeof keys.wrappedForRecovery === "string" ? { wrappedForRecovery: keys.wrappedForRecovery } : {}),
            },
          });
          await record({ operation, outcome: "ok", subject, docId });
          return send(response, 201, { document: created }, (created as { version: number }).version);
        }
        throw new HttpError(405, "unsupported", `${method} is not allowed on ${url.pathname}.`);
      }

      docId = decodeURIComponent(parts[2]);
      const tail = parts[3];

      if (!tail) {
        if (method === "GET") {
          operation = "read";
          const result = await options.store.read(docId, { seenVersion });
          await record({ operation, outcome: "ok", subject, docId });
          return send(
            response,
            200,
            { document: result.record, blobs: result.blobs.map((b) => ({ ...(b.meta as object), bytes: toBase64(b.bytes) })) },
            result.record.version,
          );
        }
        if (method === "DELETE") {
          operation = "delete";
          const deleted = await options.store.softDelete(docId);
          await record({ operation, outcome: "ok", subject, docId });
          return send(response, 200, { document: deleted }, deleted.version);
        }
        throw new HttpError(405, "unsupported", `${method} is not allowed on ${url.pathname}.`);
      }

      if (tail === "updates") {
        if (method === "GET") {
          operation = "updates";
          const since = positiveInt(url.searchParams.get("since"), "since") ?? 0;
          const result = await options.store.updatesSince(docId, since, { seenVersion });
          await record({ operation, outcome: "ok", subject, docId, detail: { since } });
          return send(
            response,
            200,
            { document: result.record, blobs: result.blobs.map((b) => ({ ...(b.meta as object), bytes: toBase64(b.bytes) })) },
            result.record.version,
          );
        }
        if (method === "POST") {
          operation = "append";
          const body = await readJson(request);
          const appended = await options.store.append({
            docId,
            kind: typeof body.kind === "string" ? body.kind : "update",
            bytes: fromBase64(body.bytes, "bytes"),
            expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : undefined,
          });
          await record({ operation, outcome: "ok", subject, docId });
          return send(response, 201, { document: appended }, appended.version);
        }
        throw new HttpError(405, "unsupported", `${method} is not allowed on ${url.pathname}.`);
      }

      if (tail === "compact" && method === "POST") {
        operation = "compact";
        const body = await readJson(request);
        const compacted = await options.store.compact(docId, {
          kind: typeof body.kind === "string" ? body.kind : "snapshot",
          bytes: fromBase64(body.bytes, "bytes"),
        });
        await record({ operation, outcome: "ok", subject, docId });
        return send(response, 200, { document: compacted }, compacted.version);
      }

      if (tail === "hold") {
        requireAdmin(subject);
        if (!options.store.setLegalHold) throw new HttpError(404, "unsupported", "This store does not support legal holds.");
        if (method === "PUT") {
          const body = await readJson(request);
          const reason = requireString(body.reason, "reason");
          const held = await options.store.setLegalHold(docId, { reason, placedBy: subject ?? "unknown" });
          operation = "legal-hold-place";
          await record({ operation, outcome: "ok", subject, docId, detail: { reason } });
          return send(response, 200, { document: held }, held.version);
        }
        if (method === "DELETE") {
          const released = await options.store.setLegalHold(docId, null);
          operation = "legal-hold-release";
          await record({ operation, outcome: "ok", subject, docId });
          return send(response, 200, { document: released }, released.version);
        }
        throw new HttpError(405, "unsupported", `${method} is not allowed on ${url.pathname}.`);
      }

      if (tail === "purge" && method === "POST") {
        requireAdmin(subject);
        if (!options.store.purge) throw new HttpError(404, "unsupported", "This store does not support purging.");
        operation = "purge";
        await options.store.purge(docId);
        await record({ operation, outcome: "ok", subject, docId });
        return send(response, 204, {});
      }

      if (tail === "restore" && method === "POST") {
        operation = "restore";
        const restored = await options.store.restore(docId);
        await record({ operation, outcome: "ok", subject, docId });
        return send(response, 200, { document: restored }, restored.version);
      }

      if (tail === "meta") {
        if (method === "GET") {
          operation = "get-meta";
          const sealed = await options.store.getMeta(docId, { seenVersion });
          const current = await options.store.head(docId, { seenVersion });
          await record({ operation, outcome: "ok", subject, docId });
          return send(response, 200, { meta: sealed ? toBase64(sealed) : null }, current.version);
        }
        if (method === "PUT") {
          operation = "set-meta";
          const body = await readJson(request);
          const updated = await options.store.setMeta(docId, fromBase64(body.meta, "meta"));
          await record({ operation, outcome: "ok", subject, docId });
          return send(response, 200, { document: updated }, updated.version);
        }
        throw new HttpError(405, "unsupported", `${method} is not allowed on ${url.pathname}.`);
      }

      throw new HttpError(404, "unsupported", `No route for ${url.pathname}.`);
    } catch (error) {
      const { status, reason, message } = describe(error);
      await record({ operation, outcome: status >= 500 ? "error" : "denied", subject, docId, detail: { reason, status } });
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
    if (parts[2] === "providers" && method === "GET") {
      return send(response, 200, { providers: [...providers.keys()] });
    }

    if (parts[2] === "session" && method === "GET") {
      if (!session) return send(response, 401, { error: { reason: "unauthenticated", message: "Not signed in." } });
      return send(response, 200, {
        session: { issuer: session.issuer, subject: session.subject, displayName: session.displayName, expiresAt: session.expiresAt },
      });
    }

    if (parts[2] === "logout" && method === "POST") {
      if (session) sessions?.destroy(session.id);
      await record({ operation: "logout", outcome: "ok", subject: session ? `${session.issuer}#${session.subject}` : null, docId: null });
      response.writeHead(204, { "set-cookie": expiredSessionCookie(secureCookies()) });
      return response.end();
    }

    if (parts[3] === "start" && method === "GET") {
      const provider = providers.get(parts[2]);
      if (!provider || !sessions) throw new HttpError(404, "unsupported", `No sign-in provider named ${parts[2]}.`);
      const { url: authorizeUrl, pending } = await provider.begin(`${publicUrl()}/v1/auth/callback`);
      sessions.remember(pending);
      await record({ operation: "login-start", outcome: "ok", subject: null, docId: null, detail: { provider: provider.id } });
      response.writeHead(302, { location: authorizeUrl });
      return response.end();
    }

    if (parts[2] === "callback" && method === "GET") {
      if (!sessions) throw new HttpError(404, "unsupported", "No sign-in is configured.");
      const error = url.searchParams.get("error");
      if (error) {
        await record({ operation: "login", outcome: "denied", subject: null, docId: null, detail: { error } });
        throw new HttpError(400, "bad-request", `The provider reported: ${error}`);
      }
      // Single-use, and unknown after ten minutes: a callback without a
      // pending sign-in is a replay or a forgery, not a login.
      const pending = sessions.take(url.searchParams.get("state"));
      if (!pending) {
        await record({ operation: "login", outcome: "denied", subject: null, docId: null, detail: { reason: "unknown-state" } });
        throw new HttpError(400, "bad-request", "This sign-in did not start here, or it has expired. Try again.");
      }
      const provider = providers.get(pending.provider);
      const code = url.searchParams.get("code");
      if (!provider || !code) throw new HttpError(400, "bad-request", "The provider returned no authorization code.");

      let identity;
      try {
        identity = await provider.complete(code, pending);
      } catch (failure) {
        await record({ operation: "login", outcome: "denied", subject: null, docId: null, detail: { provider: provider.id, message: String(failure).slice(0, 200) } });
        throw new HttpError(401, "unauthenticated", "Sign-in failed. Please try again.");
      }
      const created = sessions.create(identity);
      // Resolved once, here, rather than on every request.
      if (options.directory) created.userId = (await options.directory.upsertUser(identity)).userId;
      await record({ operation: "login", outcome: "ok", subject: `${identity.issuer}#${identity.subject}`, docId: null, detail: { provider: provider.id } });
      response.writeHead(302, {
        location: options.afterLoginUrl ?? "/",
        "set-cookie": serializeSessionCookie(created.id, {
          secure: secureCookies(),
          maxAgeSeconds: Math.max(1, Math.floor((created.expiresAt - Date.now()) / 1000)),
        }),
      });
      return response.end();
    }

    throw new HttpError(404, "unsupported", `No route for ${url.pathname}.`);
  }

  /**
   * /v1/users/me, /devices, /devices/:id/approve, /recovery, /keys.
   *
   * Only ever wraps: the store holds nothing it could use to read a
   * document. A device is inert until another approved device hands it the
   * user key (WS7-R11), and revoking one takes that wrap away (WS7-R14).
   */
  async function handleUsers(
    parts: string[],
    method: string,
    request: IncomingMessage,
    response: ServerResponse,
    session: Session | null,
  ) {
    const directory = options.directory;
    if (!directory) throw new HttpError(404, "unsupported", "This store has no user directory configured.");
    if (!session?.userId) throw new HttpError(401, "unauthenticated", "Sign in first.");
    if (parts[2] !== "me") throw new HttpError(404, "unsupported", "Only /v1/users/me is addressable.");
    const userId = session.userId;
    const subject = `${session.issuer}#${session.subject}`;
    const callingDeviceId = (request.headers["x-device-id"] as string | undefined) ?? null;
    const section = parts[3];

    if (!section && method === "GET") {
      const devices = await directory.listDevices(userId);
      return send(response, 200, {
        user: { userId, issuer: session.issuer, subject: session.subject, displayName: session.displayName },
        devices,
      });
    }

    if (section === "devices") {
      if (!parts[4] && method === "GET") {
        return send(response, 200, { devices: await directory.listDevices(userId) });
      }
      if (!parts[4] && method === "POST") {
        const body = await readJson(request);
        const device = await directory.registerDevice(userId, {
          publicKey: requireString(body.publicKey, "publicKey"),
          label: typeof body.label === "string" ? body.label : undefined,
        });
        await record({ operation: "device-register", outcome: "ok", subject, docId: null, detail: { deviceId: device.deviceId } });
        // Registered, but inert: it can reach nothing until approved.
        return send(response, 201, { device });
      }
      const deviceId = parts[4] ? decodeURIComponent(parts[4]) : null;
      if (deviceId && parts[5] === "approve" && method === "POST") {
        if (!callingDeviceId) throw new HttpError(400, "bad-request", "Approval must come from a device: send X-Device-Id.");
        const body = await readJson(request);
        const wrapped = body.wrappedUserKey as { keyWrap?: unknown; body?: unknown } | undefined;
        if (typeof wrapped?.keyWrap !== "string" || typeof wrapped?.body !== "string") {
          throw new HttpError(400, "bad-request", "wrappedUserKey must carry keyWrap and body.");
        }
        // The code the approving person confirmed, checked against the key
        // the store actually holds: a key substituted in transit produces a
        // different code, and approval fails (WS7-R11).
        const target = await directory.getDevice(userId, deviceId);
        const expected = await verificationCodeFor(target.publicKey);
        const offered = typeof body.verificationCode === "string" ? body.verificationCode.trim().toUpperCase() : "";
        if (offered !== expected) {
          await record({ operation: "device-approve", outcome: "denied", subject, docId: null, detail: { deviceId, reason: "verification-code" } });
          throw new HttpError(400, "bad-request", "The verification code does not match this device. Check both screens and try again.");
        }
        const device = await directory.approveDevice(userId, deviceId, callingDeviceId, {
          keyWrap: wrapped.keyWrap,
          body: wrapped.body,
        });
        await record({ operation: "device-approve", outcome: "ok", subject, docId: null, detail: { deviceId, approvedBy: callingDeviceId } });
        return send(response, 200, { device });
      }
      if (deviceId && !parts[5] && method === "DELETE") {
        const device = await directory.revokeDevice(userId, deviceId);
        await record({ operation: "device-revoke", outcome: "ok", subject, docId: null, detail: { deviceId } });
        return send(response, 200, { device });
      }
      throw new HttpError(405, "unsupported", `${method} is not allowed here.`);
    }

    if (section === "public-key") {
      if (method === "PUT") {
        const body = await readJson(request);
        const user = await directory.setUserPublicKey(userId, requireString(body.publicKey, "publicKey"));
        await record({ operation: "user-public-key-set", outcome: "ok", subject, docId: null });
        return send(response, 200, { user });
      }
      throw new HttpError(405, "unsupported", `${method} is not allowed here.`);
    }

    if (section === "recovery") {
      if (method === "PUT") {
        const body = await readJson(request);
        await directory.putRecovery(userId, {
          salt: requireString(body.salt, "salt"),
          sealedUserKey: requireString(body.sealedUserKey, "sealedUserKey"),
        });
        await record({ operation: "recovery-set", outcome: "ok", subject, docId: null });
        return send(response, 204, {});
      }
      if (method === "GET") {
        const recovery = await directory.getRecovery(userId);
        return send(response, 200, { recovery });
      }
      throw new HttpError(405, "unsupported", `${method} is not allowed here.`);
    }

    if (section === "keys") {
      if (method === "GET") {
        if (!callingDeviceId) throw new HttpError(400, "bad-request", "Send X-Device-Id: keys are handed to a device, not a session.");
        const device = await directory.getDevice(userId, callingDeviceId);
        if (device.revokedAt) throw new HttpError(403, "revoked", "This device has been revoked.");
        if (!device.approvedAt || !device.wrappedUserKey) {
          // Not an error: it is the state a device waits in.
          return send(response, 200, { status: "awaiting-approval", verificationCode: device.verificationCode });
        }
        return send(response, 200, {
          status: "approved",
          wrappedUserKey: device.wrappedUserKey,
          workspaceKeys: await directory.getWorkspaceKeys(userId),
        });
      }
      if (method === "PUT") {
        const body = await readJson(request);
        const generation = typeof body.generation === "number" ? body.generation : 1;
        await directory.putWorkspaceKey(userId, generation, requireString(body.wrappedKey, "wrappedKey"));
        await record({ operation: "workspace-key-set", outcome: "ok", subject, docId: null, detail: { generation } });
        return send(response, 204, {});
      }
      throw new HttpError(405, "unsupported", `${method} is not allowed here.`);
    }

    throw new HttpError(404, "unsupported", "No route for that path.");
  }

  /** WS10-R2: a store with no administrators configured has none. */
  function requireAdmin(subject: string | null) {
    if (!subject || !options.isAdmin?.(subject)) {
      throw new HttpError(403, "forbidden", "This action is for administrators.");
    }
  }

  function describe(error: unknown): { status: number; reason: string; message: string } {
    if (error instanceof HttpError) return { status: error.status, reason: error.reason, message: error.message };
    if (error instanceof StoreError) return { status: STATUS[error.reason] ?? 500, reason: error.reason, message: error.message };
    if (error instanceof DirectoryError) return { status: STATUS[error.reason] ?? 500, reason: error.reason, message: error.message };
    // Nothing unexpected reaches the client: it goes to the audit trail and
    // the log, and the caller gets a reason it can act on.
    console.error("[store] unhandled error:", error);
    return { status: 500, reason: "internal", message: "The store failed to handle this request." };
  }

  async function record(entry: Omit<AuditEntry, "at">) {
    await audit?.record({ at: new Date().toISOString(), ...entry });
  }
}

function positiveIntHeader(request: IncomingMessage, header: string): number | undefined {
  const raw = request.headers[header];
  if (typeof raw !== "string") return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "bad-request", `${header} must be a non-negative integer.`);
  }
  return parsed;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, "bad-request", `${field} is required.`);
  return value;
}

function send(response: ServerResponse, status: number, body: unknown, version?: number) {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(payload)),
    // WS8-R15: every document response says which version it is.
    ...(version !== undefined ? { "x-document-version": String(version) } : {}),
  };
  response.writeHead(status, headers);
  response.end(payload);
}
