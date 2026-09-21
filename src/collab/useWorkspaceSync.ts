/**
 * Keeping a workspace document up to date (WS8-R2, WS13).
 *
 * Saving a document to a workspace once and then leaving it to rot is
 * worse than not offering it: the interface said "saved in browser" while
 * the person believed their work was in the workspace. So once a document
 * is in a workspace, every autosave goes there too.
 *
 * This runs outside the workspace panel, which only exists while the
 * dialog is open. It attaches to the device this browser already has and
 * never registers one: enrolling is something a person does deliberately,
 * not something background saving does on their behalf.
 *
 * What travels is CRDT updates, not snapshots (documentSync.ts), so two
 * people editing the same workspace document merge rather than overwrite
 * each other - the same guarantee a live session gives.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createStoreClient, StoreClientError, type StoreClient } from './storeClient.ts';
import {
  attachExistingDevice,
  createIndexedDbDeviceKeyStorage,
  type DeviceKeyStorage,
  type EnrollmentApi,
} from './deviceIdentity.ts';
import { documentKeyFor, indexKeyFor, upsertEntry } from './workspaceDocuments.ts';
import { deriveWorkspaceRoom } from './workspaceSession.ts';
import { createDocumentSync, type DocumentSync } from './documentSync.ts';
import type * as Y from 'yjs';

export type WorkspaceSyncStatus =
  /** No store, no device, or this document is not in the workspace. */
  | 'inactive'
  | 'saving'
  | 'saved'
  /** The store is unreachable. The work is still saved in this browser. */
  | 'offline'
  | 'error';

export interface WorkspaceSyncState {
  status: WorkspaceSyncStatus;
  /**
   * The live session this document belongs to, once it is known to be in
   * the workspace: the room everyone holding its key computes, and that
   * key. Null for a local document (WS3).
   */
  session: { room: string; key: string } | null;
  /** The document version the workspace last accepted. */
  version: number | null;
  message: string | null;
}

/** Told to the panel and back, so a document saved to the workspace starts
 * syncing without a reload. */
export const WORKSPACE_CHANGED_EVENT = 'system-design:workspace-changed';

export function announceWorkspaceChange(): void {
  globalThis.dispatchEvent?.(new Event(WORKSPACE_CHANGED_EVENT));
}

const WORKSPACE_ID = 'default';

export interface WorkspaceSyncOptions {
  storeUrl: string | null;
  docId: string;
  /** The open document. Its updates are what the workspace holds. */
  doc: Y.Doc;
  /** The document's title, kept in the index so renaming shows up in
   * everyone's list rather than only inside the document. */
  title: string;
  client?: StoreClient;
  keyStorage?: DeviceKeyStorage;
}

export function useWorkspaceSync(options: WorkspaceSyncOptions) {
  const { storeUrl, docId } = options;
  const [client] = useState<StoreClient | null>(
    () => options.client ?? (storeUrl ? createStoreClient({ baseUrl: storeUrl }) : null),
  );
  const [storage] = useState<DeviceKeyStorage>(
    () => options.keyStorage ?? createIndexedDbDeviceKeyStorage(),
  );
  const [state, setState] = useState<WorkspaceSyncState>({
    status: 'inactive',
    session: null,
    version: null,
    message: null,
  });
  /** Running while this document is in the workspace. */
  const sync = useRef<DocumentSync | null>(null);

  const tracked = useRef<{
    workspaceKey: CryptoKey;
    documentKey: string;
    wrappedDocKey: string;
  } | null>(null);

  const api: EnrollmentApi | null = client && {
    registerDevice: (publicKey, label) => client.registerDevice(publicKey, label),
    keysForDevice: (deviceId) => client.keysForDevice(deviceId),
    publishUserPublicKey: (publicKey) => client.publishUserPublicKey(publicKey),
    putWorkspaceKey: (generation, wrappedKey) => client.putWorkspaceKey(generation, wrappedKey),
    listDevices: () => client.listDevices(),
    approveDevice: (deviceId, code, wrapped, from) =>
      client.approveDevice(deviceId, code, wrapped, from),
    setOwnUserKey: (deviceId, wrapped) => client.setOwnUserKey(deviceId, wrapped),
    workspaceExists: () => client.workspaceExists(WORKSPACE_ID),
  };

  const stop = useCallback(() => {
    sync.current?.stop();
    sync.current = null;
    tracked.current = null;
  }, []);

  /** Is this document in the workspace, and can this browser reach it? */
  const check = useCallback(async () => {
    if (!client || !api) return;
    try {
      const device = await attachExistingDevice({ api, storage });
      if (device.status !== 'ready' || !device.workspaceKey) {
        // Not enrolled, or waiting for approval: nothing to sync yet.
        stop();
        setState({ status: 'inactive', session: null, version: null, message: null });
        return;
      }
      const indexKey = await indexKeyFor(device.workspaceKey);
      const entry = (await client.readIndex(WORKSPACE_ID, indexKey)).entries.find(
        (candidate) => candidate.docId === docId,
      );
      if (!entry) {
        // A local document: nothing of it belongs in the workspace.
        stop();
        setState({ status: 'inactive', session: null, version: null, message: null });
        return;
      }
      if (sync.current) return;
      const documentKey = await documentKeyFor(entry, device.workspaceKey);
      tracked.current = {
        workspaceKey: device.workspaceKey,
        documentKey,
        wrappedDocKey: entry.wrappedDocKey,
      };
      // Everyone holding this key computes the same room, so opening the
      // document is enough to be in it together (WS3).
      const room = await deriveWorkspaceRoom(documentKey);
      const started = createDocumentSync({
        client,
        docId,
        documentKey,
        doc: options.doc,
        onStatus: (status, detail) =>
          setState({
            status: status === 'starting' ? 'saving' : status,
            // Carried through every status change, so the editor can join
            // the room as soon as the document is known to be shared.
            session: { room, key: documentKey },
            version: client.versionOf(docId),
            message: detail ?? null,
          }),
      });
      await started.start();
      sync.current = started;
    } catch (error) {
      stop();
      setState({
        status:
          error instanceof StoreClientError && error.reason === 'offline' ? 'offline' : 'inactive',
        session: null,
        version: null,
        message: null,
      });
    }
    // api is rebuilt each render from the stable client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, docId, storage, stop, options.doc]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return check();
    });
    const onChanged = () => void check();
    globalThis.addEventListener?.(WORKSPACE_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.(WORKSPACE_CHANGED_EVENT, onChanged);
      stop();
    };
  }, [check, stop]);

  /**
   * The title, which the index carries so that renaming a document shows
   * up in everyone's list. The document's own changes need no help: they
   * are already on their way as CRDT updates.
   */
  const writtenTitle = useRef<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    // Retried rather than cancelled: the first attempt often lands while
    // the sync is still attaching, and an earlier version marked the
    // title as written before writing it, so a cancelled timer meant the
    // new name never reached anyone else's list.
    const attempt = async (): Promise<void> => {
      if (cancelled) return;
      const target = tracked.current;
      if (!target) {
        if (!cancelled) timer = setTimeout(() => void attempt(), 2000);
        return;
      }
      if (writtenTitle.current === options.title) return;
      try {
        const indexKey = await indexKeyFor(target.workspaceKey);
        await client.updateIndex(WORKSPACE_ID, indexKey, (entries) =>
          upsertEntry(entries, {
            docId,
            wrappedDocKey: target.wrappedDocKey,
            title: options.title,
            updatedAt: new Date().toISOString(),
          }),
        );
        writtenTitle.current = options.title;
      } catch (error) {
        // Not fatal - the document itself is unaffected - but silence
        // here once hid a title that never reached anyone else's list.
        console.warn('Could not update the workspace list entry:', error);
        if (!cancelled) timer = setTimeout(() => void attempt(), 5000);
      }
    };
    let timer = setTimeout(() => void attempt(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, docId, options.title]);

  return {
    ...state,
    /** Sends anything outstanding now, for a caller about to close. */
    flush: async () => sync.current?.flush(),
    refresh: check,
    active: state.status !== 'inactive',
  };
}
