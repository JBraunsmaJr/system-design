/**
 * Where blob bytes live (WS8-R16).
 *
 * Deliberately narrow: put, get, deleteMany. Everything else about a document
 * - its version, its key wraps, its index entry, its audit trail - is
 * relational data and stays in PostgreSQL. Keeping the bytes behind this
 * interface is what lets an S3/MinIO implementation arrive later without
 * touching a route handler, once WS8-R17's measurements say it is warranted.
 *
 * `put` takes the transaction it must join, so a blob and the row that points
 * at it either both land or neither does. An implementation that cannot join
 * the transaction (an object store) must be paired with the reconciliation
 * described in WS8-R16.
 */
export interface BlobRef {
  docId: string;
  /** Unique within a document; assigned by the document service. */
  blobId: string;
}

export interface BlobStore<Tx = unknown> {
  readonly kind: "postgres" | "memory" | "object-store";
  put(ref: BlobRef, bytes: Uint8Array, tx: Tx): Promise<void>;
  get(ref: BlobRef): Promise<Uint8Array | null>;
  deleteMany(refs: BlobRef[], tx: Tx): Promise<void>;
  /** Bytes currently held, for WS8-R17's measurements and WS8-R8's quotas. */
  totalBytes(docId?: string): Promise<number>;
}

const key = (ref: BlobRef) => `${ref.docId}\u0000${ref.blobId}`;

/**
 * For tests and for a store run without PostgreSQL. It honours the same
 * transaction discipline: writes are buffered until the transaction commits,
 * so a failure part-way leaves nothing behind - the property WS8-R16 asks to
 * be tested by injecting failures.
 */
export interface MemoryTx {
  writes: Map<string, Uint8Array>;
  deletes: Set<string>;
  committed: boolean;
}

export interface MemoryBlobStore extends BlobStore<MemoryTx> {
  begin(): MemoryTx;
  commit(tx: MemoryTx): void;
  rollback(tx: MemoryTx): void;
  size(): number;
}

export function createMemoryBlobStore(): MemoryBlobStore {
  const blobs = new Map<string, Uint8Array>();

  return {
    kind: "memory",

    begin() {
      return { writes: new Map(), deletes: new Set(), committed: false };
    },

    commit(tx) {
      if (tx.committed) throw new Error("This transaction has already been committed.");
      for (const [k, bytes] of tx.writes) blobs.set(k, bytes);
      for (const k of tx.deletes) blobs.delete(k);
      tx.committed = true;
    },

    rollback(tx) {
      tx.writes.clear();
      tx.deletes.clear();
    },

    async put(ref, bytes, tx) {
      tx.writes.set(key(ref), new Uint8Array(bytes));
    },

    async get(ref) {
      const found = blobs.get(key(ref));
      return found ? new Uint8Array(found) : null;
    },

    async deleteMany(refs, tx) {
      for (const ref of refs) tx.deletes.add(key(ref));
    },

    async totalBytes(docId) {
      let total = 0;
      for (const [k, bytes] of blobs) {
        if (docId === undefined || k.startsWith(`${docId}\u0000`)) total += bytes.length;
      }
      return total;
    },

    size() {
      return blobs.size;
    },
  };
}
