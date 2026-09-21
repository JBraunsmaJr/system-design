/**
 * Multi-document local storage (WS2-R3, WS2-R4, WS2-R6, WS5-R8).
 *
 * Replaces the single `system-design-editor:autosave` localStorage slot. Two
 * problems with that slot drove this: two tabs holding different diagrams
 * overwrite each other, and a quota failure was swallowed so the user kept
 * editing believing their work was saved.
 *
 * This module owns the document INDEX and document SNAPSHOTS. It does not own
 * live CRDT state - once WS1 lands, `y-indexeddb` persists the Y.Doc itself
 * under its own key and this store keeps the index plus an exportable snapshot
 * beside it. Keeping the index separate from Yjs is deliberate: listing
 * documents must not require constructing and loading every Y.Doc.
 *
 * Storage is reached through a small backend seam so the logic here is
 * testable in Node without a browser, and so the parts that can only be tested
 * against a real IndexedDB are as thin as possible.
 */
import type { DiagramFile } from './serialization.ts';
import { parseDiagramFile, SCHEMA_VERSION } from './serialization.ts';
import { SchemaVersionError } from './schemaMigrations.ts';

/** localStorage key written by every release up to and including v0.92.1. */
export const LEGACY_AUTOSAVE_KEY = 'system-design-editor:autosave';

const INDEX_KEY = 'index';
const DOC_PREFIX = 'doc:';

export type StorageFailureReason =
  /** No storage at all - private browsing, disabled, or an unsupported engine. */
  | 'unavailable'
  /** Out of space. The single most important one to surface, not swallow. */
  | 'quota'
  | 'not-found'
  /** Present but unparseable. Distinct from `version`: this one is worthless. */
  | 'corrupt'
  /** Intact, but written by a newer build. Must never be overwritten. */
  | 'version'
  | 'unknown';

export type StorageResult<T> =
  { ok: true; value: T } | { ok: false; reason: StorageFailureReason; message: string };

function fail<T>(reason: StorageFailureReason, message: string): StorageResult<T> {
  return { ok: false, reason, message };
}

/**
 * Classifies a thrown storage error.
 *
 * Quota errors are the reason this exists. Browsers disagree on how they
 * report one - `QuotaExceededError`, a legacy numeric code, or Firefox's
 * `NS_ERROR_DOM_QUOTA_REACHED` - and getting this wrong means a full disk
 * looks like a generic failure and the user is told nothing useful.
 */
export function classifyStorageError(error: unknown): StorageFailureReason {
  if (error instanceof SchemaVersionError) return 'version';
  if (error instanceof SyntaxError) return 'corrupt';

  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  ) {
    return 'quota';
  }
  if (name === 'SecurityError' || name === 'InvalidStateError') {
    return 'unavailable';
  }
  return 'unknown';
}

export interface DocumentIndexEntry {
  docId: string;
  title: string;
  /** ISO timestamp of the last successful write. */
  updatedAt: string;
  createdAt: string;
  /** Schema version of the stored snapshot, so the list can mark documents
   * this build cannot open without loading each one. */
  schemaVersion: string;
  /** Where the document came from. `session` documents retain their room so a
   * participant can rehost an empty room later (WS13-R12). */
  origin: 'local' | 'session';
  sessionRoom?: string;
  /** The session's encryption key, kept with the local copy so a former
   * participant can host the same room again and the original link still
   * works (WS13-R12). Local storage only, like the content it protects. */
  sessionKey?: string;
  /** When this document was last saved while in a session: the latest time any
   * other participant may have received it. Rebase is blocked within the
   * reconciliation window of this (WS4-R8). */
  lastSessionAt?: string;
  /** Approximate serialized size, for surfacing storage pressure. */
  sizeBytes: number;
}

export interface DocumentIndex {
  /** Index format version, independent of the diagram schema version. */
  version: 1;
  entries: DocumentIndexEntry[];
}

const EMPTY_INDEX: DocumentIndex = { version: 1, entries: [] };

export interface BackendEntry {
  key: string;
  value: string;
}

/**
 * Minimal persistence surface.
 *
 * `writeAll` must be atomic: the index and the document it references are
 * written together, or neither is. Without that guarantee a failure between
 * the two leaves an index entry pointing at nothing, or an orphaned document
 * invisible to the list.
 */
/** What a `modify` callback returns: the key's new value, plus anything else
 * to write or delete in the same atomic step. */
export interface BackendModification {
  value: string;
  also?: BackendEntry[];
  remove?: string[];
}

export interface DocumentBackend {
  read(key: string): Promise<string | null>;
  /**
   * Reads `key`, computes its replacement synchronously, and writes it -
   * together with `also` and `remove` - in ONE atomic step.
   *
   * Optional, but without it index updates are read-then-write across two
   * steps, and two tabs saving different documents at the same moment can
   * each write an index missing the other's entry (WS2-R3). The document
   * itself survives either way; reconcile() finds it.
   */
  modify?(key: string, mutate: (current: string | null) => BackendModification): Promise<void>;
  writeAll(entries: BackendEntry[]): Promise<void>;
  deleteAll(keys: string[]): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
}

/** In-memory backend for tests and for degraded operation when storage is
 * unavailable - editing continues, nothing survives a reload, and the caller
 * is told via `available`. */
export function createMemoryBackend(): DocumentBackend & {
  readonly size: number;
} {
  const map = new Map<string, string>();
  return {
    get size() {
      return map.size;
    },
    async read(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async writeAll(entries) {
      for (const { key, value } of entries) map.set(key, value);
    },
    async modify(key, mutate) {
      const result = mutate(map.has(key) ? (map.get(key) as string) : null);
      map.set(key, result.value);
      for (const e of result.also ?? []) map.set(e.key, e.value);
      for (const k of result.remove ?? []) map.delete(k);
    },
    async deleteAll(keys) {
      for (const key of keys) map.delete(key);
    },
    async listKeys(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

export interface DocumentStore {
  listDocuments(): Promise<StorageResult<DocumentIndexEntry[]>>;
  readDocument(docId: string): Promise<StorageResult<DiagramFile>>;
  writeDocument(
    docId: string,
    file: DiagramFile,
    options?: { origin?: 'local' | 'session'; sessionRoom?: string; sessionKey?: string },
  ): Promise<StorageResult<DocumentIndexEntry>>;
  renameDocument(docId: string, title: string): Promise<StorageResult<DocumentIndexEntry>>;
  /** WS2-R6: deletes content AND index entry. Distinct from disconnecting. */
  deleteDocument(docId: string): Promise<StorageResult<void>>;
  /** Reports index entries with no document, and documents with no entry. */
  reconcile(): Promise<StorageResult<{ danglingEntries: string[]; orphanedDocuments: string[] }>>;
  importLegacyAutosave(
    readLegacy: () => string | null,
    clearLegacy: () => void,
  ): Promise<StorageResult<DocumentIndexEntry | null>>;
}

export function createDocumentStore(backend: DocumentBackend): DocumentStore {
  async function readIndex(): Promise<DocumentIndex> {
    return parseIndex(await backend.read(INDEX_KEY));
  }

  /**
   * Applies `build` to the current index and writes the result, atomically
   * where the backend supports it. `build` must be synchronous: it runs inside
   * a storage transaction.
   */
  async function updateIndex(
    build: (index: DocumentIndex) => {
      index: DocumentIndex;
      also?: BackendEntry[];
      remove?: string[];
    },
  ): Promise<void> {
    if (backend.modify) {
      await backend.modify(INDEX_KEY, (raw) => {
        const result = build(parseIndex(raw));
        return { value: JSON.stringify(result.index), also: result.also, remove: result.remove };
      });
      return;
    }
    const result = build(await readIndex());
    await backend.writeAll([
      ...(result.also ?? []),
      { key: INDEX_KEY, value: JSON.stringify(result.index) },
    ]);
    if (result.remove?.length) await backend.deleteAll(result.remove);
  }

  function parseIndex(raw: string | null): DocumentIndex {
    if (raw === null) return { ...EMPTY_INDEX, entries: [] };
    try {
      const parsed = JSON.parse(raw) as DocumentIndex;
      if (!parsed || !Array.isArray(parsed.entries)) {
        return { ...EMPTY_INDEX, entries: [] };
      }
      return parsed;
    } catch {
      // A corrupt index is recoverable: reconcile() rebuilds it from the
      // documents themselves, which are stored independently for exactly
      // this reason. Losing the index must never mean losing documents.
      return { ...EMPTY_INDEX, entries: [] };
    }
  }

  function upsert(index: DocumentIndex, entry: DocumentIndexEntry): DocumentIndex {
    const others = index.entries.filter((e) => e.docId !== entry.docId);
    return { version: 1, entries: [...others, entry] };
  }

  return {
    async listDocuments() {
      try {
        const index = await readIndex();
        const sorted = [...index.entries].sort((a, b) =>
          a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
        );
        return { ok: true, value: sorted };
      } catch (error) {
        return fail(classifyStorageError(error), 'Could not read the document list.');
      }
    },

    async readDocument(docId) {
      let raw: string | null;
      try {
        raw = await backend.read(DOC_PREFIX + docId);
      } catch (error) {
        return fail(classifyStorageError(error), `Could not read document ${docId}.`);
      }
      if (raw === null) {
        return fail('not-found', `No stored document with id ${docId}.`);
      }
      try {
        return { ok: true, value: parseDiagramFile(raw) };
      } catch (error) {
        const reason = classifyStorageError(error);
        return fail(
          reason,
          reason === 'version'
            ? (error as SchemaVersionError).message
            : `Document ${docId} could not be read and may be damaged.`,
        );
      }
    },

    async writeDocument(docId, file, options) {
      const serialized = JSON.stringify(file);
      const now = new Date().toISOString();
      let written: DocumentIndexEntry | null = null;
      try {
        // Atomic: an index entry pointing at a document that failed to write
        // is worse than no entry at all - and the index is read inside the
        // same step, so a concurrent save of another document is kept.
        await updateIndex((index) => {
          const existing = index.entries.find((e) => e.docId === docId);
          const entry: DocumentIndexEntry = {
            docId,
            title: file.title || 'Untitled Diagram',
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            schemaVersion: file.schemaVersion ?? SCHEMA_VERSION,
            origin: options?.origin ?? existing?.origin ?? 'local',
            ...((options?.sessionRoom ?? existing?.sessionRoom)
              ? { sessionRoom: options?.sessionRoom ?? existing?.sessionRoom }
              : {}),
            ...((options?.sessionKey ?? existing?.sessionKey)
              ? { sessionKey: options?.sessionKey ?? existing?.sessionKey }
              : {}),
            ...(options?.origin === 'session'
              ? { lastSessionAt: now }
              : existing?.lastSessionAt
                ? { lastSessionAt: existing.lastSessionAt }
                : {}),
            sizeBytes: serialized.length,
          };
          written = entry;
          return {
            index: upsert(index, entry),
            also: [{ key: DOC_PREFIX + docId, value: serialized }],
          };
        });
        return { ok: true, value: written as unknown as DocumentIndexEntry };
      } catch (error) {
        const reason = classifyStorageError(error);
        return fail(
          reason,
          reason === 'quota'
            ? 'There is no space left to save this document. Export it to a file before making further changes.'
            : `Could not save document ${docId}.`,
        );
      }
    },

    async renameDocument(docId, title) {
      let renamed: DocumentIndexEntry | null = null;
      try {
        await updateIndex((index) => {
          const existing = index.entries.find((e) => e.docId === docId);
          if (!existing) return { index };
          renamed = { ...existing, title, updatedAt: new Date().toISOString() };
          return { index: upsert(index, renamed) };
        });
        if (!renamed) return fail('not-found', `No stored document with id ${docId}.`);
        return { ok: true, value: renamed };
      } catch (error) {
        return fail(classifyStorageError(error), `Could not rename ${docId}.`);
      }
    },

    async deleteDocument(docId) {
      try {
        await updateIndex((index) => ({
          index: { version: 1, entries: index.entries.filter((e) => e.docId !== docId) },
          remove: [DOC_PREFIX + docId],
        }));
        return { ok: true, value: undefined };
      } catch (error) {
        return fail(classifyStorageError(error), `Could not delete ${docId}.`);
      }
    },

    async reconcile() {
      try {
        const index = await readIndex();
        const keys = await backend.listKeys(DOC_PREFIX);
        const stored = new Set(keys.map((k) => k.slice(DOC_PREFIX.length)));
        const indexed = new Set(index.entries.map((e) => e.docId));
        return {
          ok: true,
          value: {
            danglingEntries: [...indexed].filter((id) => !stored.has(id)),
            orphanedDocuments: [...stored].filter((id) => !indexed.has(id)),
          },
        };
      } catch (error) {
        return fail(classifyStorageError(error), 'Could not reconcile storage.');
      }
    },

    /**
     * WS5-R8. Runs once on first launch after upgrading. The legacy key is
     * cleared only after the import is confirmed written - a crash between the
     * two costs a duplicate document, which is recoverable; the other ordering
     * costs the user their work, which is not.
     */
    async importLegacyAutosave(readLegacy, clearLegacy) {
      let raw: string | null;
      try {
        raw = readLegacy();
      } catch (error) {
        return fail(classifyStorageError(error), 'Could not read the previous auto-saved draft.');
      }
      if (raw === null || raw.trim() === '') {
        return { ok: true, value: null };
      }

      let file: DiagramFile;
      try {
        file = parseDiagramFile(raw);
      } catch (error) {
        const reason = classifyStorageError(error);
        // Leave the legacy key alone. A draft this build cannot read is not a
        // draft this build gets to delete.
        return fail(
          reason,
          reason === 'version'
            ? (error as SchemaVersionError).message
            : 'The previous auto-saved draft could not be read and was left in place.',
        );
      }

      const docId = newDocumentId();
      const written = await this.writeDocument(docId, {
        ...file,
        title: file.title || 'Recovered draft',
      });
      if (!written.ok) return written;

      try {
        clearLegacy();
      } catch {
        // Import succeeded; failing to clean up the old key is harmless and
        // the next run simply finds nothing new to do.
      }
      return { ok: true, value: written.value };
    },
  };
}

export function newDocumentId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Only reached on engines without randomUUID; ids are local-only and never
  // security-bearing, so a timestamp plus randomness is sufficient here.
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface StorageHealth {
  /** Whether the browser granted durable storage - eviction under pressure is
   * a real risk across the one-week offline window (WS2-R5, OQ-10). */
  persisted: boolean;
  usageBytes?: number;
  quotaBytes?: number;
}

export async function requestPersistentStorage(): Promise<StorageHealth> {
  const storage = globalThis.navigator?.storage;
  if (!storage) return { persisted: false };

  let persisted = false;
  try {
    if (typeof storage.persisted === 'function') {
      persisted = await storage.persisted();
    }
    if (!persisted && typeof storage.persist === 'function') {
      persisted = await storage.persist();
    }
  } catch {
    persisted = false;
  }

  try {
    if (typeof storage.estimate === 'function') {
      const estimate = await storage.estimate();
      return {
        persisted,
        usageBytes: estimate.usage,
        quotaBytes: estimate.quota,
      };
    }
  } catch {
    // Estimation is advisory; its absence must not affect the persist result.
  }
  return { persisted };
}
