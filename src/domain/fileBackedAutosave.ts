/**
 * File-backed autosave (WS13-R1 through R4, WS13-R8).
 *
 * The strongest durability promise the app can make without any
 * infrastructure: the user picks a file once, and edits stream to it as they
 * work. The document then survives a cleared browser profile, lives somewhere
 * the user controls, and can be committed to git. For a self-contained tool,
 * "your diagram is a file you own" beats "your diagram is in a database
 * somewhere" - and it makes the peer-to-peer durability problem mostly
 * disappear, since there is always a copy on disk.
 *
 * Chromium only. Firefox and Safari have no File System Access API, and the
 * fallback there is the export watermark - deliberately a separate mechanism
 * rather than a pretence that this one is working. WS13-R8 is the rule: never
 * imply file autosave is active when it is not.
 *
 * Structural types are used throughout rather than the DOM's
 * FileSystemFileHandle so the logic is testable in Node against a fake, and so
 * this compiles where the DOM lib does not describe the API.
 */

export interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface FileLike {
  lastModified: number;
  text(): Promise<string>;
}

export interface FileHandleLike {
  name: string;
  getFile(): Promise<FileLike>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export type FileAttachmentState =
  /** No file chosen. */
  | 'none'
  /** Handle held and permission granted; writes are happening. */
  | 'attached'
  /** Handle held but permission must be re-requested on a user gesture.
   * Write permission does NOT silently persist across visits, so this is the
   * normal state on a fresh page load, not an error. */
  | 'needs-permission'
  /** Permission refused, or the handle is no longer usable. */
  | 'denied';

export type FileWriteResult =
  | { ok: true; lastModified: number }
  | { ok: false; reason: 'permission'; message: string }
  | {
      ok: false;
      reason: 'conflict';
      message: string;
      /** What the file says now, so the caller can offer a real choice rather
       * than just refusing. */
      externalLastModified: number;
    }
  | { ok: false; reason: 'write-failed'; message: string };

export function isFileAccessSupported(): boolean {
  return typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

export interface FileBackedAutosave {
  state(): FileAttachmentState;
  fileName(): string | null;
  /** Adopts a handle. Checks permission without prompting - prompting requires
   * a user gesture, which this is not guaranteed to be. */
  attach(handle: FileHandleLike): Promise<FileAttachmentState>;
  /** Re-requests write permission. MUST be called from a user gesture. */
  requestPermission(): Promise<FileAttachmentState>;
  /** Writes the document. Refuses rather than overwrites when the file has
   * changed underneath us. */
  write(contents: string): Promise<FileWriteResult>;
  /** Writes even though the file changed externally. Separate method so an
   * overwrite is always an explicit decision. */
  overwrite(contents: string): Promise<FileWriteResult>;
  /** Reads the file's current contents, for resolving a conflict. */
  readExternal(): Promise<string | null>;
  detach(): void;
}

export function createFileBackedAutosave(): FileBackedAutosave {
  let handle: FileHandleLike | null = null;
  let state: FileAttachmentState = 'none';
  /** lastModified as of our own last write. A file whose timestamp has moved
   * since then was changed by something else - a git checkout, another
   * editor - and blindly writing over that is data loss. */
  let observedLastModified: number | null = null;

  async function permissionState(h: FileHandleLike, prompt: boolean): Promise<PermissionState> {
    const query = prompt ? h.requestPermission : h.queryPermission;
    if (!query) {
      // An implementation without the permission API behaves as granted; the
      // write itself will fail if it is not.
      return 'granted';
    }
    try {
      return await query.call(h, { mode: 'readwrite' });
    } catch {
      return 'denied';
    }
  }

  function applyPermission(result: PermissionState): FileAttachmentState {
    state = result === 'granted' ? 'attached' : result === 'prompt' ? 'needs-permission' : 'denied';
    return state;
  }

  async function writeInternal(contents: string, force: boolean): Promise<FileWriteResult> {
    if (!handle) {
      return {
        ok: false,
        reason: 'permission',
        message: 'No file is attached to this document.',
      };
    }
    if (state !== 'attached') {
      return {
        ok: false,
        reason: 'permission',
        message: 'This browser needs permission again before it can write to the file.',
      };
    }

    if (!force && observedLastModified !== null) {
      try {
        const current = await handle.getFile();
        if (current.lastModified !== observedLastModified) {
          return {
            ok: false,
            reason: 'conflict',
            message: `${handle.name} was changed by something else since it was last saved from here.`,
            externalLastModified: current.lastModified,
          };
        }
      } catch {
        // If the file cannot be read, fall through and let the write report
        // the real failure rather than inventing a conflict.
      }
    }

    try {
      // createWritable writes to a swap file and replaces the target
      // atomically on close, so a crash mid-write leaves the previous complete
      // version rather than a truncated one (WS13-R3).
      const writable = await handle.createWritable();
      try {
        await writable.write(contents);
      } finally {
        await writable.close();
      }
      const after = await handle.getFile();
      observedLastModified = after.lastModified;
      return { ok: true, lastModified: after.lastModified };
    } catch (error) {
      const name =
        typeof error === 'object' && error !== null && 'name' in error
          ? String((error as { name: unknown }).name)
          : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        state = 'needs-permission';
        return {
          ok: false,
          reason: 'permission',
          message:
            'Permission to write to the file was withdrawn. Grant it again to resume saving.',
        };
      }
      return {
        ok: false,
        reason: 'write-failed',
        message: `Could not write to ${handle.name}.`,
      };
    }
  }

  return {
    state: () => state,
    fileName: () => handle?.name ?? null,

    async attach(next) {
      handle = next;
      observedLastModified = null;
      const result = applyPermission(await permissionState(next, false));
      if (result === 'attached') {
        try {
          observedLastModified = (await next.getFile()).lastModified;
        } catch {
          observedLastModified = null;
        }
      }
      return result;
    },

    async requestPermission() {
      if (!handle) return state;
      const result = applyPermission(await permissionState(handle, true));
      if (result === 'attached' && observedLastModified === null) {
        try {
          observedLastModified = (await handle.getFile()).lastModified;
        } catch {
          observedLastModified = null;
        }
      }
      return result;
    },

    write: (contents) => writeInternal(contents, false),
    overwrite: (contents) => writeInternal(contents, true),

    async readExternal() {
      if (!handle) return null;
      try {
        return await (await handle.getFile()).text();
      } catch {
        return null;
      }
    },

    detach() {
      handle = null;
      state = 'none';
      observedLastModified = null;
    },
  };
}

/**
 * Stores a file handle across visits (WS13-R2).
 *
 * Handles are structured-cloneable, so IndexedDB can hold them where
 * localStorage cannot. Re-acquiring one does NOT restore write permission -
 * that needs a user gesture - which is why `attach` reports needs-permission
 * rather than assuming.
 */
export interface FileHandleStore {
  get(docId: string): Promise<FileHandleLike | null>;
  set(docId: string, handle: FileHandleLike): Promise<void>;
  delete(docId: string): Promise<void>;
}

const HANDLE_DB = 'system-design-file-handles';
const HANDLE_STORE = 'handles';

export function createIndexedDbHandleStore(
  factory: IDBFactory = globalThis.indexedDB,
): FileHandleStore {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = factory.open(HANDLE_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) {
          db.createObjectStore(HANDLE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, mode);
      const request = work(tx.objectStore(HANDLE_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    async get(docId) {
      try {
        const value = await run<unknown>('readonly', (s) => s.get(docId));
        return (value as FileHandleLike | undefined) ?? null;
      } catch {
        return null;
      }
    },
    async set(docId, handle) {
      await run('readwrite', (s) => s.put(handle, docId));
    },
    async delete(docId) {
      await run('readwrite', (s) => s.delete(docId));
    },
  };
}
