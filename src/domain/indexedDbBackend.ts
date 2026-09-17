/**
 * IndexedDB implementation of DocumentBackend (WS2-R1).
 *
 * Deliberately thin. Every decision that can be made in documentStore.ts is
 * made there, where it can be tested against the in-memory backend; what
 * remains here is the part that genuinely needs a database, so the surface
 * that only a browser (or fake-indexeddb) can exercise stays small.
 *
 * One object store, string keys, string values. `writeAll` relies on
 * IndexedDB's own transaction atomicity rather than reimplementing it: the
 * index and the document it references must land together or not at all.
 */
import type { BackendEntry, DocumentBackend } from "./documentStore.ts";

export const DB_NAME = "system-design-editor";
export const DB_VERSION = 1;
export const STORE_NAME = "documents";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof globalThis.indexedDB?.open === "function";
  } catch {
    // Accessing indexedDB itself throws in some privacy configurations.
    return false;
  }
}

export function openDatabase(
  factory: IDBFactory = globalThis.indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new Error(
          "The storage database is blocked by another tab. Close other tabs and reload.",
        ),
      );
  });
}

export function createIndexedDbBackend(
  factory: IDBFactory = globalThis.indexedDB,
): DocumentBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function db(): Promise<IDBDatabase> {
    // Reset on failure so a transient open error doesn't permanently poison
    // the store for the rest of the session.
    if (!dbPromise) {
      dbPromise = openDatabase(factory).catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  async function transact(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => void | Promise<void>,
  ): Promise<void> {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      tx.oncomplete = () => resolve();
      // Surface the underlying DOMException (QuotaExceededError and friends)
      // rather than a generic one - documentStore classifies on it.
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted."));
      try {
        void work(tx.objectStore(STORE_NAME));
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  return {
    async read(key: string): Promise<string | null> {
      const database = await db();
      const tx = database.transaction(STORE_NAME, "readonly");
      const value = await promisify<unknown>(
        tx.objectStore(STORE_NAME).get(key),
      );
      return typeof value === "string" ? value : null;
    },

    async writeAll(entries: BackendEntry[]): Promise<void> {
      await transact("readwrite", (store) => {
        for (const { key, value } of entries) store.put(value, key);
      });
    },

    async modify(key, mutate): Promise<void> {
      const database = await db();
      // Read, compute and write inside ONE readwrite transaction. IndexedDB
      // serialises overlapping readwrite transactions, so two tabs updating
      // the index cannot both read the old value.
      let failure: unknown = null;
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(failure ?? tx.error);
        tx.onabort = () => reject(failure ?? tx.error ?? new Error("Transaction aborted."));
        const get = store.get(key);
        get.onsuccess = () => {
          try {
            // Synchronous by contract: awaiting here would let the
            // transaction auto-commit before the writes are queued.
            const result = mutate(typeof get.result === "string" ? get.result : null);
            store.put(result.value, key);
            for (const e of result.also ?? []) store.put(e.value, e.key);
            for (const k of result.remove ?? []) store.delete(k);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      });
    },

    async deleteAll(keys: string[]): Promise<void> {
      await transact("readwrite", (store) => {
        for (const key of keys) store.delete(key);
      });
    },

    async listKeys(prefix: string): Promise<string[]> {
      const database = await db();
      const tx = database.transaction(STORE_NAME, "readonly");
      const keys = await promisify<IDBValidKey[]>(
        tx.objectStore(STORE_NAME).getAllKeys(),
      );
      return keys
        .filter((k): k is string => typeof k === "string")
        .filter((k) => k.startsWith(prefix));
    },
  };
}
