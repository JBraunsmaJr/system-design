/**
 * Talking to the store from the browser (WS6, WS7-R1, WS8-R15, WS9).
 *
 * Everything is sealed here, before it leaves: the store receives ciphertext
 * and wrapped keys and can read none of it. The document key comes from the
 * share link, the storage key is derived from it, and the workspace index is
 * sealed under the workspace key.
 *
 * Two rules this client enforces on the store's behalf:
 *
 * - **Versions never go backwards** (WS8-R15). The client remembers the
 *   highest version it has seen for each document, sends it with every read,
 *   and refuses a response that claims to be older - a store replaying an
 *   earlier state is a failure, not something to apply.
 * - **Index writes are conditional** (WS9-R3). A collision means re-reading
 *   and re-applying the change, not overwriting someone else's.
 */
import { createStorageCrypto, type CryptoMode, type StorageCrypto } from "../crypto/storageCrypto.ts";
import { deriveStorageKey } from "../crypto/keys.ts";
import type { BlobContext } from "../crypto/envelope.ts";
import type { DiagramFile } from "../domain/serialization.ts";

export interface StoreClientOptions {
  /** Where the store is, e.g. https://store.example.com */
  baseUrl: string;
  /** Injected for tests; defaults to the platform fetch with cookies. */
  fetch?: typeof fetch;
  mode?: CryptoMode;
}

export type StoreClientErrorReason =
  | "unauthenticated"
  | "not-found"
  | "deleted"
  | "conflict"
  | "rolled-back"
  | "quota"
  | "too-large"
  | "offline"
  | "unreadable"
  | "store-error";

export class StoreClientError extends Error {
  reason: StoreClientErrorReason;
  status?: number;

  constructor(message: string, reason: StoreClientErrorReason, status?: number) {
    super(message);
    this.name = "StoreClientError";
    this.reason = reason;
    this.status = status;
  }
}

export interface IndexEntry {
  docId: string;
  /** The document key, wrapped under the workspace key (WS7-R3). */
  wrappedDocKey: string;
  title: string;
  updatedAt: string;
}

export interface SessionInfo {
  issuer: string;
  subject: string;
  displayName?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export function createStoreClient(options: StoreClientOptions) {
  const call = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, credentials: "include" }));
  const crypto: StorageCrypto = createStorageCrypto(options.mode ?? "webcrypto");
  const base = options.baseUrl.replace(/\/+$/, "");
  /** The highest version seen per document (WS8-R15). */
  const seen = new Map<string, number>();

  async function request(
    path: string,
    init: RequestInit & { docId?: string } = {},
  ): Promise<{ status: number; body: Record<string, unknown>; version: number | null }> {
    const docId = init.docId;
    const known = docId ? seen.get(docId) : undefined;
    let response: Response;
    try {
      response = await call(`${base}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(known !== undefined ? { "if-document-version": String(known) } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      // The store being unreachable is ordinary - the editor works without
      // it - so it is its own reason rather than an error to surface raw.
      throw new StoreClientError(`The store could not be reached: ${String(error)}`, "offline");
    }
    const text = await response.text();
    let body: Record<string, unknown>;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new StoreClientError("The store returned something that is not JSON.", "store-error", response.status);
    }
    const header = response.headers.get("x-document-version");
    const version = header === null ? null : Number(header);
    if (docId && version !== null) {
      const highest = seen.get(docId);
      if (highest !== undefined && version < highest) {
        throw new StoreClientError(
          `The store returned version ${version} of ${docId}, older than version ${highest} already seen. Not applying it.`,
          "rolled-back",
        );
      }
      seen.set(docId, version);
    }
    if (!response.ok) {
      const error = (body.error ?? {}) as { reason?: string; message?: string };
      const reason: StoreClientErrorReason =
        error.reason === "stale-version"
          ? "rolled-back"
          : (["unauthenticated", "not-found", "deleted", "conflict", "quota", "too-large"] as const).includes(
                error.reason as never,
              )
            ? (error.reason as StoreClientErrorReason)
            : "store-error";
      throw new StoreClientError(error.message ?? `The store refused the request (${response.status}).`, reason, response.status);
    }
    return { status: response.status, body, version };
  }

  const contextFor = (docId: string, kind: BlobContext["kind"], version: number): BlobContext => ({ docId, kind, version });

  return {
    /** What the store is: its mode, and whether it requires sign-in. A
     * client shows the WS6-R3 warning from `cryptoMode: "passthrough"`. */
    async health(): Promise<{ cryptoMode: "webcrypto" | "passthrough"; authentication: "none" | "required" }> {
      const { body } = await request("/v1/health");
      return {
        cryptoMode: (body.cryptoMode as "webcrypto" | "passthrough") ?? "webcrypto",
        authentication: (body.authentication as "none" | "required") ?? "required",
      };
    },

    /** Who the store thinks we are, or null when not signed in. */
    async session(): Promise<SessionInfo | null> {
      try {
        const { body } = await request("/v1/auth/session");
        return (body.session as SessionInfo) ?? null;
      } catch (error) {
        if (error instanceof StoreClientError && error.reason === "unauthenticated") return null;
        throw error;
      }
    },

    /** Ends the session at the store, so the cookie stops working. */
    async logout(): Promise<void> {
      await request("/v1/auth/logout", { method: "POST" });
    },

    async providers(): Promise<string[]> {
      const { body } = await request("/v1/auth/providers");
      return (body.providers as string[]) ?? [];
    },

    /** The highest version this client has seen, for the durability UI. */
    versionOf(docId: string): number | null {
      return seen.get(docId) ?? null;
    },

    /**
     * Uploads a document as one sealed snapshot, creating it if needed.
     * The blob is sealed with the storage key derived from the document key
     * (WS7-R1), bound to this document and version (WS6-R4).
     */
    async putDocument(docId: string, documentKey: string, file: DiagramFile, wraps: { wrappedForWorkspace: string; wrappedForRecovery?: string }): Promise<number> {
      const key = await deriveStorageKey(documentKey);
      let version = seen.get(docId) ?? null;
      if (version === null) {
        try {
          const head = await request(`/v1/docs/${encodeURIComponent(docId)}`, { docId });
          version = (head.body.document as { version: number }).version;
        } catch (error) {
          if (!(error instanceof StoreClientError) || error.reason !== "not-found") throw error;
          const created = await request("/v1/docs", {
            method: "POST",
            docId,
            body: JSON.stringify({ docId, keys: wraps }),
          });
          version = (created.body.document as { version: number }).version;
        }
      }
      // Sealed against the version it will carry: the store increments on
      // accepting it, so a blob written at version n is opened at n.
      const next = version + 1;
      const sealed = await crypto.seal(contextFor(docId, "snapshot", next), encoder.encode(JSON.stringify(file)), key);
      const appended = await request(`/v1/docs/${encodeURIComponent(docId)}/compact`, {
        method: "POST",
        docId,
        body: JSON.stringify({ kind: "snapshot", bytes: toBase64(sealed) }),
      });
      return (appended.body.document as { version: number }).version;
    },

    /** Fetches and opens a document. */
    async getDocument(docId: string, documentKey: string): Promise<{ file: DiagramFile; version: number }> {
      const key = await deriveStorageKey(documentKey);
      const { body } = await request(`/v1/docs/${encodeURIComponent(docId)}`, { docId });
      const record = body.document as { version: number };
      const blobs = (body.blobs as { kind: string; version: number; bytes: string }[]) ?? [];
      const snapshot = [...blobs].reverse().find((blob) => blob.kind === "snapshot") ?? blobs[blobs.length - 1];
      if (!snapshot) throw new StoreClientError(`Document ${docId} holds nothing yet.`, "not-found");
      let plaintext: Uint8Array;
      try {
        plaintext = await crypto.open(contextFor(docId, snapshot.kind as BlobContext["kind"], snapshot.version), fromBase64(snapshot.bytes), key);
      } catch (error) {
        // The link's key does not match what sealed this, or the blob was
        // altered. Either way it is not something to open.
        throw new StoreClientError(
          `Could not open ${docId}: the key does not match, or the stored data was altered. (${String(error)})`,
          "unreadable",
        );
      }
      try {
        return { file: JSON.parse(decoder.decode(plaintext)) as DiagramFile, version: record.version };
      } catch {
        throw new StoreClientError(`Document ${docId} opened, but does not contain a diagram.`, "unreadable");
      }
    },

    async deleteDocument(docId: string): Promise<void> {
      await request(`/v1/docs/${encodeURIComponent(docId)}`, { method: "DELETE", docId });
    },

    // -- devices and keys (WS7-R8, R11) ------------------------------------

    async registerDevice(publicKey: string, label?: string) {
      const { body } = await request("/v1/users/me/devices", { method: "POST", body: JSON.stringify({ publicKey, label }) });
      return body.device as { deviceId: string; verificationCode: string; approvedAt: string | null };
    },

    async listDevices() {
      const { body } = await request("/v1/users/me/devices");
      return body.devices as { deviceId: string; publicKey: string; verificationCode: string; approvedAt: string | null; revokedAt: string | null; label?: string }[];
    },

    /** What this device is given: nothing until another approves it. */
    async keysForDevice(deviceId: string) {
      const { body } = await request("/v1/users/me/keys", { headers: { "x-device-id": deviceId } });
      return body as
        | { status: "awaiting-approval"; verificationCode: string }
        | { status: "needs-setup"; verificationCode: string }
        | { status: "approved"; wrappedUserKey: { keyWrap: string; body: string }; workspaceKeys: { generation: number; wrappedKey: string }[] };
    },

    async approveDevice(deviceId: string, verificationCode: string, wrappedUserKey: { keyWrap: string; body: string }, fromDeviceId: string) {
      await request(`/v1/users/me/devices/${encodeURIComponent(deviceId)}/approve`, {
        method: "POST",
        headers: { "x-device-id": fromDeviceId },
        body: JSON.stringify({ verificationCode, wrappedUserKey }),
      });
    },

    /** The first device storing the user key it generated, wrapped to
     * itself, so its next visit can recover it. */
    async setOwnUserKey(deviceId: string, wrappedUserKey: { keyWrap: string; body: string }) {
      await request(`/v1/users/me/devices/${encodeURIComponent(deviceId)}/user-key`, {
        method: "PUT",
        headers: { "x-device-id": deviceId },
        body: JSON.stringify({ wrappedUserKey }),
      });
    },

    async revokeDevice(deviceId: string) {
      await request(`/v1/users/me/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
    },

    async publishUserPublicKey(publicKey: string) {
      await request("/v1/users/me/public-key", { method: "PUT", body: JSON.stringify({ publicKey }) });
    },

    async putWorkspaceKey(generation: number, wrappedKey: string) {
      await request("/v1/users/me/keys", { method: "PUT", body: JSON.stringify({ generation, wrappedKey }) });
    },

    /** WS7-R12: the sealed user key and its salt, for unlocking with a
     * recovery code on a browser with no approved device. */
    async putRecovery(salt: string, sealedUserKey: string) {
      await request("/v1/users/me/recovery", { method: "PUT", body: JSON.stringify({ salt, sealedUserKey }) });
    },

    async getRecovery() {
      const { body } = await request("/v1/users/me/recovery");
      return (body.recovery as { salt: string; sealedUserKey: string } | null) ?? null;
    },

    // -- the workspace index (WS9) -----------------------------------------

    async readIndex(workspaceId: string, indexKey: CryptoKey): Promise<{ entries: IndexEntry[]; version: number | null }> {
      const { body } = await request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/index`);
      const sealed = body.index as string | null;
      const version = (body.version as number | null) ?? null;
      if (!sealed) return { entries: [], version };
      const opened = await crypto.open(
        { docId: workspaceId, kind: "index", version: 1 },
        fromBase64(sealed),
        indexKey,
      );
      return { entries: JSON.parse(decoder.decode(opened)) as IndexEntry[], version };
    },

    /**
     * Applies a change to the index, re-reading and re-applying if someone
     * else wrote first (WS9-R3). `change` runs again on the fresh entries,
     * so it must be a function of what is there, not a precomputed list.
     */
    async updateIndex(
      workspaceId: string,
      indexKey: CryptoKey,
      change: (entries: IndexEntry[]) => IndexEntry[],
      attempts = 5,
    ): Promise<IndexEntry[]> {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const { entries, version } = await this.readIndex(workspaceId, indexKey);
        const next = change(entries);
        const sealed = await crypto.seal(
          { docId: workspaceId, kind: "index", version: 1 },
          encoder.encode(JSON.stringify(next)),
          indexKey,
        );
        try {
          await request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/index`, {
            method: "PUT",
            body: JSON.stringify({ index: toBase64(sealed), expectedVersion: version }),
          });
          return next;
        } catch (error) {
          const isCollision = error instanceof StoreClientError && error.reason === "conflict";
          if (!isCollision || attempt === attempts) throw error;
          // Someone else wrote between the read and the write: read again
          // and apply the change to what is now there.
        }
      }
      throw new StoreClientError("The workspace index is being changed faster than this client can keep up.", "conflict");
    },
  };
}

export type StoreClient = ReturnType<typeof createStoreClient>;
