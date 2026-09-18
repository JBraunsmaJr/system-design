/**
 * The PostgreSQL implementation (WS8-R16, OQ-17).
 *
 * The blob store and the document service share one transaction, so the
 * version bump, the blob, and its metadata land together or not at all. That
 * is the property an object store cannot give us for free, and the reason the
 * bytes live here until WS8-R17's measurements say otherwise.
 *
 * Every value the store holds for a document is opaque: sealed blobs and
 * wrapped keys. Nothing here interprets them, and a database dump reveals no
 * document content.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import type { BlobRef, BlobStore } from "./blobStore.ts";
import {
  StoreError,
  type AppendRequest,
  type AppendResult,
  type CreateRequest,
  type DocumentRecord,
  type ReadOptions,
  type StoredBlobMeta,
} from "./documentService.ts";

export type PgTx = pg.PoolClient;

export interface PostgresStoreOptions {
  connectionString: string;
  /** WS8-R8. */
  maxBlobBytes?: number;
  now?: () => Date;
}

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "..", "schema.sql");

export function createPostgresBlobStore(pool: pg.Pool): BlobStore<PgTx> {
  return {
    kind: "postgres",

    async put(ref, bytes, tx) {
      // Joins the caller's transaction: the row in `blobs` and these bytes
      // commit together.
      await tx.query(
        `INSERT INTO blob_data (doc_id, blob_id, bytes) VALUES ($1, $2, $3)
         ON CONFLICT (doc_id, blob_id) DO UPDATE SET bytes = EXCLUDED.bytes`,
        [ref.docId, ref.blobId, Buffer.from(bytes)],
      );
    },

    async get(ref) {
      const result = await pool.query<{ bytes: Buffer }>(
        `SELECT bytes FROM blob_data WHERE doc_id = $1 AND blob_id = $2`,
        [ref.docId, ref.blobId],
      );
      return result.rows[0] ? new Uint8Array(result.rows[0].bytes) : null;
    },

    async deleteMany(refs: BlobRef[], tx) {
      if (refs.length === 0) return;
      await tx.query(`DELETE FROM blob_data WHERE doc_id = $1 AND blob_id = ANY($2::text[])`, [
        refs[0].docId,
        refs.map((ref) => ref.blobId),
      ]);
    },

    async totalBytes(docId) {
      const result = docId
        ? await pool.query<{ total: string | null }>(`SELECT SUM(LENGTH(bytes)) AS total FROM blob_data WHERE doc_id = $1`, [docId])
        : await pool.query<{ total: string | null }>(`SELECT SUM(LENGTH(bytes)) AS total FROM blob_data`);
      return Number(result.rows[0]?.total ?? 0);
    },
  };
}

interface DocumentRow {
  doc_id: string;
  version: string;
  updated_at: Date;
  deleted_at: Date | null;
  wrapped_for_workspace: Buffer;
  wrapped_for_recovery: Buffer | null;
}

interface BlobRow {
  blob_id: string;
  kind: string;
  version: string;
  byte_length: number;
  created_at: Date;
}

const toMeta = (row: BlobRow): StoredBlobMeta => ({
  blobId: row.blob_id,
  kind: row.kind,
  version: Number(row.version),
  bytes: row.byte_length,
  createdAt: row.created_at.toISOString(),
});

const toRecord = (row: DocumentRow, blobs: StoredBlobMeta[]): DocumentRecord => ({
  docId: row.doc_id,
  version: Number(row.version),
  updatedAt: row.updated_at.toISOString(),
  deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  keys: {
    wrappedForWorkspace: row.wrapped_for_workspace.toString("base64"),
    ...(row.wrapped_for_recovery ? { wrappedForRecovery: row.wrapped_for_recovery.toString("base64") } : {}),
  },
  blobs,
});

let blobCounter = 0;

/**
 * The same interface as the in-process service, so one contract suite covers
 * both (scripts/verify-store-contract.ts).
 */
export function createPostgresStore(options: PostgresStoreOptions) {
  const pool = new pg.Pool({ connectionString: options.connectionString });
  const blobs = createPostgresBlobStore(pool);
  const maxBlobBytes = options.maxBlobBytes ?? 8 * 1024 * 1024;
  const now = options.now ?? (() => new Date());

  async function inTransaction<T>(work: (tx: PgTx) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Locks the row for the duration of a write, so two appends cannot read
   * the same version and both build on it. */
  async function lockDocument(tx: PgTx, docId: string, opts: ReadOptions = {}): Promise<DocumentRow> {
    const result = await tx.query<DocumentRow>(`SELECT * FROM documents WHERE doc_id = $1 FOR UPDATE`, [docId]);
    const row = result.rows[0];
    if (!row) throw new StoreError(`No document ${docId}.`, "not-found");
    if (row.deleted_at && !opts.includeDeleted) throw new StoreError(`Document ${docId} is deleted.`, "deleted");
    return row;
  }

  /** Reads inside a transaction must use that transaction: a pooled
   * connection is a different session and would see the pre-commit state,
   * which returned a stale blob list from compact(). */
  async function blobsOf(docId: string, executor: pg.Pool | PgTx = pool): Promise<StoredBlobMeta[]> {
    const result = await executor.query<BlobRow>(
      `SELECT blob_id, kind, version, byte_length, created_at FROM blobs WHERE doc_id = $1 ORDER BY created_at, blob_id`,
      [docId],
    );
    return result.rows.map(toMeta);
  }

  async function requireRow(docId: string, opts: ReadOptions = {}): Promise<DocumentRow> {
    const result = await pool.query<DocumentRow>(`SELECT * FROM documents WHERE doc_id = $1`, [docId]);
    const row = result.rows[0];
    if (!row) throw new StoreError(`No document ${docId}.`, "not-found");
    if (row.deleted_at && !opts.includeDeleted) throw new StoreError(`Document ${docId} is deleted.`, "deleted");
    if (opts.seenVersion !== undefined && Number(row.version) < opts.seenVersion) {
      throw new StoreError(
        `The store returned version ${row.version} for ${docId}, but version ${opts.seenVersion} has already been seen. Refusing to go backwards.`,
        "stale-version",
      );
    }
    return row;
  }

  return {
    /** Applies schema.sql. Idempotent; safe to run at startup. */
    async migrate(): Promise<void> {
      await pool.query(readFileSync(schemaPath, "utf8"));
    },

    async close(): Promise<void> {
      await pool.end();
    },

    async create(request: CreateRequest): Promise<DocumentRecord> {
      const at = now();
      try {
        const result = await pool.query<DocumentRow>(
          `INSERT INTO documents (doc_id, version, created_at, updated_at, wrapped_for_workspace, wrapped_for_recovery)
           VALUES ($1, 1, $2, $2, $3, $4) RETURNING *`,
          [
            request.docId,
            at,
            Buffer.from(request.keys.wrappedForWorkspace, "base64"),
            request.keys.wrappedForRecovery ? Buffer.from(request.keys.wrappedForRecovery, "base64") : null,
          ],
        );
        return toRecord(result.rows[0], []);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new StoreError(`Document ${request.docId} already exists.`, "conflict");
        }
        throw error;
      }
    },

    async append(request: AppendRequest): Promise<AppendResult> {
      if (request.bytes.length > maxBlobBytes) {
        throw new StoreError(`A blob of ${request.bytes.length} bytes exceeds the ${maxBlobBytes}-byte limit.`, "too-large");
      }
      return inTransaction(async (tx) => {
        const row = await lockDocument(tx, request.docId);
        const current = Number(row.version);
        if (request.expectedVersion !== undefined && request.expectedVersion !== current) {
          throw new StoreError(`Expected version ${request.expectedVersion}, but ${request.docId} is at ${current}.`, "conflict");
        }
        const version = current + 1;
        const blobId = `b${(++blobCounter).toString(36)}${Date.now().toString(36)}`;
        const at = now();
        // Metadata first: blob_data references blobs, so the bytes cannot be
        // written before the row that owns them. Both are in this transaction.
        await tx.query(
          `INSERT INTO blobs (doc_id, blob_id, kind, version, byte_length, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [request.docId, blobId, request.kind, version, request.bytes.length, at],
        );
        await blobs.put({ docId: request.docId, blobId }, request.bytes, tx);
        await tx.query(`UPDATE documents SET version = $2, updated_at = $3 WHERE doc_id = $1`, [request.docId, version, at]);
        return {
          docId: request.docId,
          version,
          updatedAt: at.toISOString(),
          blob: { blobId, kind: request.kind, version, bytes: request.bytes.length, createdAt: at.toISOString() },
        };
      });
    },

    async read(docId: string, opts: ReadOptions = {}) {
      const row = await requireRow(docId, opts);
      // One query for every blob and its bytes. Fetching them one at a time
      // cost a round trip each: 93 ms to open a 1,000-blob document in
      // WS8-R17's measurements, against 8 ms this way.
      const result = await pool.query<BlobRow & { bytes: Buffer }>(
        `SELECT b.blob_id, b.kind, b.version, b.byte_length, b.created_at, d.bytes
           FROM blobs b JOIN blob_data d ON d.doc_id = b.doc_id AND d.blob_id = b.blob_id
          WHERE b.doc_id = $1
          ORDER BY b.created_at, b.blob_id`,
        [docId],
      );
      const metas = result.rows.map(toMeta);
      return {
        record: toRecord(row, metas),
        blobs: result.rows.map((r, i) => ({ meta: metas[i], bytes: new Uint8Array(r.bytes) })),
      };
    },

    async head(docId: string, opts: ReadOptions = {}): Promise<DocumentRecord> {
      return toRecord(await requireRow(docId, opts), await blobsOf(docId));
    },

    async list(opts: { includeDeleted?: boolean } = {}): Promise<DocumentRecord[]> {
      // Two queries, not one per document: listing 500 documents cost 49 ms
      // that way, against 4 ms here.
      const documents = await pool.query<DocumentRow>(
        opts.includeDeleted
          ? `SELECT * FROM documents ORDER BY updated_at DESC`
          : `SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
      );
      if (documents.rows.length === 0) return [];
      const metas = await pool.query<BlobRow & { doc_id: string }>(
        `SELECT doc_id, blob_id, kind, version, byte_length, created_at
           FROM blobs WHERE doc_id = ANY($1::text[]) ORDER BY created_at, blob_id`,
        [documents.rows.map((row) => row.doc_id)],
      );
      const byDocument = new Map<string, StoredBlobMeta[]>();
      for (const row of metas.rows) {
        const list = byDocument.get(row.doc_id) ?? [];
        list.push(toMeta(row));
        byDocument.set(row.doc_id, list);
      }
      return documents.rows.map((row) => toRecord(row, byDocument.get(row.doc_id) ?? []));
    },

    async softDelete(docId: string): Promise<DocumentRecord> {
      return inTransaction(async (tx) => {
        const row = await lockDocument(tx, docId);
        const at = now();
        const version = Number(row.version) + 1;
        const updated = await tx.query<DocumentRow>(
          `UPDATE documents SET deleted_at = $2, updated_at = $2, version = $3 WHERE doc_id = $1 RETURNING *`,
          [docId, at, version],
        );
        return toRecord(updated.rows[0], await blobsOf(docId, tx));
      });
    },

    async restore(docId: string): Promise<DocumentRecord> {
      return inTransaction(async (tx) => {
        const row = await lockDocument(tx, docId, { includeDeleted: true });
        if (!row.deleted_at) throw new StoreError(`Document ${docId} is not deleted.`, "conflict");
        const at = now();
        const version = Number(row.version) + 1;
        const updated = await tx.query<DocumentRow>(
          `UPDATE documents SET deleted_at = NULL, updated_at = $2, version = $3 WHERE doc_id = $1 RETURNING *`,
          [docId, at, version],
        );
        return toRecord(updated.rows[0], await blobsOf(docId, tx));
      });
    },

    async purge(docId: string): Promise<void> {
      await inTransaction(async (tx) => {
        const result = await tx.query(`DELETE FROM documents WHERE doc_id = $1`, [docId]);
        if (result.rowCount === 0) throw new StoreError(`No document ${docId}.`, "not-found");
        // blobs and blob_data cascade from documents.
      });
    },

    async compact(docId: string, snapshot: { kind: string; bytes: Uint8Array }): Promise<DocumentRecord> {
      return inTransaction(async (tx) => {
        const row = await lockDocument(tx, docId);
        const at = now();
        const version = Number(row.version) + 1;
        const blobId = `b${(++blobCounter).toString(36)}${Date.now().toString(36)}`;
        await tx.query(
          `INSERT INTO blobs (doc_id, blob_id, kind, version, byte_length, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [docId, blobId, snapshot.kind, version, snapshot.bytes.length, at],
        );
        await blobs.put({ docId, blobId }, snapshot.bytes, tx);
        // The snapshot supersedes everything written before it.
        await tx.query(`DELETE FROM blobs WHERE doc_id = $1 AND blob_id <> $2`, [docId, blobId]);
        const updated = await tx.query<DocumentRow>(
          `UPDATE documents SET version = $2, updated_at = $3 WHERE doc_id = $1 RETURNING *`,
          [docId, version, at],
        );
        return toRecord(updated.rows[0], await blobsOf(docId, tx));
      });
    },

    /** For the contract suite's failure injection and measurements. */
    blobs,
  };
}

export type PostgresStore = ReturnType<typeof createPostgresStore>;
