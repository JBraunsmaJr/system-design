/**
 * The store's document service: what a route handler calls.
 *
 * Two rules shape it:
 *
 * - **Blobs are opaque** (WS8-R1). Nothing here parses, orders, or merges
 *   them; the service has no dependency on `yjs` and never sees plaintext.
 * - **Every accepted write moves the document's version forward** (WS8-R15),
 *   and a reader that has seen a version refuses anything older. That is what
 *   stops a compromised or rolled-back store replaying an earlier state,
 *   which encryption alone cannot detect.
 *
 * One transaction covers the version bump, the blob, and the index row
 * (WS8-R16), so a failure part-way leaves nothing behind.
 */
import type { BlobStore } from './blobStore.ts';
import { parseRetentionPeriod, purgeDueAt, type RetentionPeriod } from './retention.ts';

export interface StoredBlobMeta {
  blobId: string;
  kind: string;
  bytes: number;
  createdAt: string;
  /** The document version this blob was written at. */
  version: number;
}

export interface DocumentRecord {
  docId: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
  /** When purge becomes due (WS10-R4); null under indefinite retention, or
   * while the document is not deleted. */
  purgeAfter: string | null;
  /** WS10-R8: prevents purge in every retention mode. */
  legalHold: { reason: string; placedBy: string; placedAt: string } | null;
  /** Wrapped document keys, opaque to the store (WS7-R3, WS7-R4). */
  keys: { wrappedForWorkspace: string; wrappedForRecovery?: string };
  blobs: StoredBlobMeta[];
}

/**
 * What an append returns: the new version and the blob just written, not the
 * whole document. Returning every blob's metadata made each append cost more
 * than the last - visible in WS8-R17's measurements as append time growing
 * with the log - and a client appending does not need the list it already has.
 */
export interface AppendResult {
  docId: string;
  version: number;
  updatedAt: string;
  blob: StoredBlobMeta;
}

export interface AppendRequest {
  docId: string;
  kind: string;
  bytes: Uint8Array;
  /** The version the client believes it is building on. A write against a
   * stale version is refused, so two clients cannot silently interleave. */
  expectedVersion?: number;
}

export type StoreErrorReason =
  'not-found' | 'conflict' | 'stale-version' | 'deleted' | 'too-large' | 'quota';

export class StoreError extends Error {
  reason: StoreErrorReason;

  constructor(message: string, reason: StoreErrorReason) {
    super(message);
    this.name = 'StoreError';
    this.reason = reason;
  }
}

export interface DocumentServiceOptions<Tx> {
  blobs: BlobStore<Tx>;

  begin(): Tx;

  commit(tx: Tx): void | Promise<void>;

  rollback(tx: Tx): void | Promise<void>;

  /** Injected so tests can freeze it and so audit rows and version bumps
   * agree on one moment. */
  now?: () => Date;
  /** WS8-R8. */
  maxBlobBytes?: number;
  maxBlobsPerDocument?: number;
  maxTotalBytes?: number;
  /** WS10-R4. Defaults to 30 days. */
  retention?: RetentionPeriod;
}

export interface CreateRequest {
  docId: string;
  keys: DocumentRecord['keys'];
}

export interface ReadOptions {
  /** The highest version this client has already seen. A response older than
   * that is refused rather than returned (WS8-R15). */
  seenVersion?: number;
  includeDeleted?: boolean;
}

interface Row {
  record: DocumentRecord;
  blobIds: string[];
  /** Sealed metadata (WS9-R1). Ciphertext to the store. */
  meta?: Uint8Array;
}

let blobCounter = 0;

/**
 * An in-process implementation over any BlobStore. The PostgreSQL service
 * (Phase 3) implements the same interface with the same semantics, which
 * scripts/verify-store-contract.ts checks against both.
 */
export function createDocumentService<Tx>(options: DocumentServiceOptions<Tx>) {
  const rows = new Map<string, Row>();
  const now = options.now ?? (() => new Date());
  const maxBlobBytes = options.maxBlobBytes ?? 8 * 1024 * 1024;
  const maxBlobsPerDocument = options.maxBlobsPerDocument ?? 100_000;
  const maxTotalBytes = options.maxTotalBytes ?? Number.POSITIVE_INFINITY;
  const retention = options.retention ?? parseRetentionPeriod(undefined);

  function require(docId: string, opts: ReadOptions = {}): Row {
    const row = rows.get(docId);
    if (!row) throw new StoreError(`No document ${docId}.`, 'not-found');
    if (row.record.deletedAt && !opts.includeDeleted) {
      throw new StoreError(`Document ${docId} is deleted.`, 'deleted');
    }
    if (opts.seenVersion !== undefined && row.record.version < opts.seenVersion) {
      throw new StoreError(
        `The store returned version ${row.record.version} for ${docId}, but version ${opts.seenVersion} has already been seen. ` +
          `Refusing to go backwards.`,
        'stale-version',
      );
    }
    return row;
  }

  return {
    async create(request: CreateRequest): Promise<DocumentRecord> {
      if (rows.has(request.docId))
        throw new StoreError(`Document ${request.docId} already exists.`, 'conflict');
      const at = now().toISOString();
      const record: DocumentRecord = {
        docId: request.docId,
        version: 1,
        updatedAt: at,
        deletedAt: null,
        purgeAfter: null,
        legalHold: null,
        keys: request.keys,
        blobs: [],
      };
      rows.set(request.docId, { record, blobIds: [] });
      return structuredClone(record);
    },

    async append(request: AppendRequest): Promise<AppendResult> {
      const row = require(request.docId);
      if (request.bytes.length > maxBlobBytes) {
        throw new StoreError(
          `A blob of ${request.bytes.length} bytes exceeds the ${maxBlobBytes}-byte limit.`,
          'too-large',
        );
      }
      if (row.record.blobs.length >= maxBlobsPerDocument) {
        throw new StoreError(
          `Document ${request.docId} already holds ${row.record.blobs.length} blobs, the configured limit. Compact it before appending more.`,
          'quota',
        );
      }
      if ((await options.blobs.totalBytes()) + request.bytes.length > maxTotalBytes) {
        throw new StoreError(`This workspace has reached its storage quota.`, 'quota');
      }
      if (request.expectedVersion !== undefined && request.expectedVersion !== row.record.version) {
        throw new StoreError(
          `Expected version ${request.expectedVersion}, but ${request.docId} is at ${row.record.version}.`,
          'conflict',
        );
      }
      const blobId = `b${(++blobCounter).toString(36)}`;
      const tx = options.begin();
      try {
        await options.blobs.put({ docId: request.docId, blobId }, request.bytes, tx);
        // The version moves with the write, inside the same transaction.
        const at = now().toISOString();
        const version = row.record.version + 1;
        await options.commit(tx);
        row.record.version = version;
        row.record.updatedAt = at;
        const meta: StoredBlobMeta = {
          blobId,
          kind: request.kind,
          bytes: request.bytes.length,
          createdAt: at,
          version,
        };
        row.record.blobs.push(meta);
        row.blobIds.push(blobId);
        return { docId: request.docId, version, updatedAt: at, blob: { ...meta } };
      } catch (error) {
        await options.rollback(tx);
        throw error;
      }
    },

    /** WS8-R2: blobs written after `since`, for a client catching up. */
    async updatesSince(docId: string, since: number, opts: ReadOptions = {}) {
      const row = require(docId, opts);
      const wanted = row.record.blobs.filter((meta) => meta.version > since);
      const out: { meta: StoredBlobMeta; bytes: Uint8Array }[] = [];
      for (const meta of wanted) {
        const bytes = await options.blobs.get({ docId, blobId: meta.blobId });
        if (bytes) out.push({ meta, bytes });
      }
      return { record: structuredClone(row.record), blobs: out };
    },

    /** WS7-R7: the document key re-wrapped under a new workspace key. Only
     * the wrap changes; no content is re-encrypted. Deleted documents are
     * re-wrapped too, so they stay restorable (WS10-R4). */
    async setWorkspaceWrap(docId: string, wrappedForWorkspace: string): Promise<DocumentRecord> {
      const row = require(docId, { includeDeleted: true });
      row.record.keys = { ...row.record.keys, wrappedForWorkspace };
      return structuredClone(row.record);
    },

    /** WS8-R2, WS9-R1: sealed per-document metadata, opaque to the store. */
    async getMeta(docId: string, opts: ReadOptions = {}): Promise<Uint8Array | null> {
      const row = require(docId, opts);
      return row.meta ? new Uint8Array(row.meta) : null;
    },

    async setMeta(docId: string, sealed: Uint8Array): Promise<DocumentRecord> {
      const row = require(docId);
      row.meta = new Uint8Array(sealed);
      row.record.version += 1;
      row.record.updatedAt = now().toISOString();
      return structuredClone(row.record);
    },

    async read(
      docId: string,
      opts: ReadOptions = {},
    ): Promise<{
      record: DocumentRecord;
      blobs: { meta: StoredBlobMeta; bytes: Uint8Array }[];
    }> {
      const row = require(docId, opts);
      const blobs: { meta: StoredBlobMeta; bytes: Uint8Array }[] = [];
      for (const meta of row.record.blobs) {
        const bytes = await options.blobs.get({ docId, blobId: meta.blobId });
        if (bytes) blobs.push({ meta, bytes });
      }
      return { record: structuredClone(row.record), blobs };
    },

    async head(docId: string, opts: ReadOptions = {}): Promise<DocumentRecord> {
      return structuredClone(require(docId, opts).record);
    },

    async list(opts: { includeDeleted?: boolean } = {}): Promise<DocumentRecord[]> {
      return [...rows.values()]
        .filter((row) => opts.includeDeleted || !row.record.deletedAt)
        .map((row) => structuredClone(row.record))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    /**
     * Deletion (WS10-R4). Soft by default: the row and its blobs stay until
     * purge. Under `immediate` retention the document is purged in the same
     * call - unless a legal hold applies, which outranks every mode
     * (WS10-R8), in which case it is soft-deleted and kept.
     */
    async softDelete(docId: string): Promise<DocumentRecord> {
      const row = require(docId);
      const at = now();
      row.record.deletedAt = at.toISOString();
      row.record.version += 1;
      row.record.updatedAt = row.record.deletedAt;
      const due = row.record.legalHold ? null : purgeDueAt(retention, at);
      row.record.purgeAfter = due ? due.toISOString() : null;
      const deleted = structuredClone(row.record);
      if (retention.kind === 'immediate' && !row.record.legalHold) {
        await this.purge(docId);
      }
      return deleted;
    },

    /** WS10-R8. Held documents survive purge, and survive `immediate`. */
    async setLegalHold(
      docId: string,
      hold: { reason: string; placedBy: string } | null,
    ): Promise<DocumentRecord> {
      const row = require(docId, { includeDeleted: true });
      row.record.legalHold = hold ? { ...hold, placedAt: now().toISOString() } : null;
      if (hold) row.record.purgeAfter = null;
      else if (row.record.deletedAt) {
        const due = purgeDueAt(retention, new Date(row.record.deletedAt));
        row.record.purgeAfter = due ? due.toISOString() : null;
      }
      return structuredClone(row.record);
    },

    /** The sweep: everything past its retention and not held. */
    async purgeDue(at: Date = now()): Promise<string[]> {
      const due = [...rows.values()]
        .filter(
          (row) =>
            row.record.deletedAt &&
            !row.record.legalHold &&
            row.record.purgeAfter &&
            new Date(row.record.purgeAfter) <= at,
        )
        .map((row) => row.record.docId);
      for (const docId of due) await this.purge(docId);
      return due;
    },

    async restore(docId: string): Promise<DocumentRecord> {
      const row = require(docId, { includeDeleted: true });
      if (!row.record.deletedAt)
        throw new StoreError(`Document ${docId} is not deleted.`, 'conflict');
      row.record.deletedAt = null;
      row.record.purgeAfter = null;
      row.record.version += 1;
      row.record.updatedAt = now().toISOString();
      return structuredClone(row.record);
    },

    /** Irreversible; only for a document whose retention has ended (WS10-R4). */
    async purge(docId: string): Promise<void> {
      const row = rows.get(docId);
      if (!row) throw new StoreError(`No document ${docId}.`, 'not-found');
      if (row.record.legalHold) {
        throw new StoreError(
          `Document ${docId} is under legal hold (${row.record.legalHold.reason}) and cannot be purged until it is released.`,
          'conflict',
        );
      }
      const tx = options.begin();
      try {
        await options.blobs.deleteMany(
          row.blobIds.map((blobId) => ({ docId, blobId })),
          tx,
        );
        await options.commit(tx);
        rows.delete(docId);
      } catch (error) {
        await options.rollback(tx);
        throw error;
      }
    },

    /**
     * Replaces the blob log with one snapshot (WS8-R5). The document's
     * identity and version history are untouched; this is compaction, never
     * a rebase.
     */
    async compact(
      docId: string,
      snapshot: { kind: string; bytes: Uint8Array },
    ): Promise<DocumentRecord> {
      const row = require(docId);
      const blobId = `b${(++blobCounter).toString(36)}`;
      const superseded = row.blobIds.map((id) => ({ docId, blobId: id }));
      const tx = options.begin();
      try {
        await options.blobs.put({ docId, blobId }, snapshot.bytes, tx);
        await options.blobs.deleteMany(superseded, tx);
        const at = now().toISOString();
        const version = row.record.version + 1;
        await options.commit(tx);
        row.record.version = version;
        row.record.updatedAt = at;
        row.record.blobs = [
          {
            blobId,
            kind: snapshot.kind,
            bytes: snapshot.bytes.length,
            createdAt: at,
            version,
          },
        ];
        row.blobIds = [blobId];
      } catch (error) {
        await options.rollback(tx);
        throw error;
      }
      return structuredClone(row.record);
    },
  };
}

export type DocumentService<Tx = unknown> = ReturnType<typeof createDocumentService<Tx>>;
