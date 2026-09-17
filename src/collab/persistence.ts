/**
 * Local persistence for a shared Y.Doc (WS2-R1, WS2-R2, WS2-R6).
 *
 * Closes the hole that made collaborative sessions unsafe to rely on: document
 * state lived only in connected browsers' memory, so the last participant to
 * close their tab took an hour of group work with them. With this attached,
 * every participant's browser is an independent replica, a reopened session
 * link loads instantly from disk, and a session survives everyone leaving as
 * long as one of them comes back.
 *
 * `y-indexeddb` replays stored updates into the doc on open. Because those are
 * CRDT updates, replaying local history and then syncing with a peer converges
 * exactly as two live peers do - there is no merge logic here and no
 * which-copy-wins question to answer.
 *
 * What this does NOT provide is a team-wide source of truth. Someone who was
 * never in a session and joins after everyone has gone still finds an empty
 * room; only a prior participant can rehost it (WS13-R12). The server-side
 * store is what closes that gap, and it is a separate decision.
 */
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { isYjsDocEmpty } from "./seedGuards.ts";

/** Namespaced so a room can never collide with the document-store keys, which
 * live in their own database. */
export function persistenceKeyForRoom(roomName: string): string {
  return `system-design:room:${roomName}`;
}

export interface DocPersistence {
  /** Resolves once stored updates have been replayed into the doc. Callers
   * MUST await this before deciding whether to seed (WS2-R2) - seeding a
   * document that persistence is about to populate is how duplicates happen. */
  readonly whenSynced: Promise<void>;
  /** Whether the document was empty at the moment sync completed, which is the
   * only honest basis for a seed decision. */
  wasEmptyOnLoad(): boolean;
  /** Stops persisting. Leaves stored data intact - this is what disconnecting
   * from a session does. */
  destroy(): Promise<void>;
  /** Stops persisting AND erases the local replica. This is "forget this
   * document", a deliberate, separately-confirmed action. Keeping it distinct
   * from destroy() is the point: leaving a session must never be the same
   * gesture as discarding the only copy of the work. */
  forget(): Promise<void>;
  /**
   * Compaction (WS4-R7): replaces the stored update log with one equivalent
   * state update. Document identity and CRDT state are unchanged, so a client
   * that was offline merges exactly as before - which is what makes this safe
   * to run at any time, with no coordination. It never rebases; that is a
   * separate, deliberate operation (rebase.ts).
   */
  compact?(): Promise<CompactionResult>;
}

export interface CompactionResult {
  /** Stored update records before and after. */
  updatesBefore: number;
  updatesAfter: number;
}

export interface AttachPersistenceOptions {
  /** Overridable so tests and the perf harness can run without touching a
   * real database. */
  createProvider?: (key: string, doc: Y.Doc) => IndexeddbPersistence;
}

/**
 * A no-op used where storage is unavailable - private browsing, storage
 * disabled, or an engine without IndexedDB. Editing continues; nothing
 * survives a reload. The caller is responsible for telling the user, which is
 * why this reports `wasEmptyOnLoad` honestly rather than pretending.
 */
export function createNullPersistence(doc: Y.Doc): DocPersistence {
  const empty = isYjsDocEmpty(doc);
  return {
    whenSynced: Promise.resolve(),
    wasEmptyOnLoad: () => empty,
    destroy: async () => {},
    forget: async () => {},
  };
}

export function attachPersistence(
  doc: Y.Doc,
  key: string,
  options: AttachPersistenceOptions = {},
): DocPersistence {
  const create =
    options.createProvider ??
    ((k: string, d: Y.Doc) => new IndexeddbPersistence(k, d));

  const provider = create(key, doc);
  let emptyOnLoad = true;
  let settled = false;

  const whenSynced = provider.whenSynced
    .then(() => {
      emptyOnLoad = isYjsDocEmpty(doc);
      settled = true;
    })
    .catch((error: unknown) => {
      // A failed open must not prevent the session from starting. Treating the
      // document as non-empty here would suppress seeding and leave the user
      // staring at a blank canvas; treating it as empty is the safe direction
      // because the seeds are idempotent (WS1-R6).
      console.warn("Local persistence unavailable for this document:", error);
      emptyOnLoad = isYjsDocEmpty(doc);
      settled = true;
    });

  return {
    whenSynced,
    wasEmptyOnLoad() {
      if (!settled) {
        throw new Error(
          "wasEmptyOnLoad() read before whenSynced resolved - await it first, " +
            "or the seed decision is made against a document that has not " +
            "finished loading.",
        );
      }
      return emptyOnLoad;
    },
    async destroy() {
      await provider.destroy();
    },
    async forget() {
      // clearData() destroys the provider as part of its work.
      await provider.clearData();
    },
    async compact() {
      await whenSynced;
      const db = (provider as unknown as { db: IDBDatabase | null }).db;
      if (!db) return { updatesBefore: 0, updatesAfter: 0 };
      // Done here rather than with y-indexeddb's storeState, which resolves
      // before its own write has happened. One readwrite transaction: IndexedDB
      // serialises it against the provider's own writes, and the state is
      // encoded INSIDE it, so every update about to be deleted is already in
      // that state - the provider applies an update to the doc before storing it.
      const updatesBefore = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction([UPDATES_STORE], "readwrite");
        const store = tx.objectStore(UPDATES_STORE);
        let count = 0;
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          const found = keys.result as IDBValidKey[];
          count = found.length;
          if (count <= 1) return;
          const last = found[found.length - 1];
          store.add(Y.encodeStateAsUpdate(doc));
          store.delete(IDBKeyRange.upperBound(last));
        };
        tx.oncomplete = () => resolve(count);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Compaction aborted."));
      });
      const updatesAfter = Math.min(updatesBefore, 1);
      // The provider trims on its own once this passes a threshold; keep its
      // count honest so it does not trim again straight away.
      (provider as unknown as { _dbsize: number })._dbsize = updatesAfter;
      return { updatesBefore, updatesAfter };
    },
  };
}

/** y-indexeddb's object store for the update log. */
const UPDATES_STORE = "updates";
