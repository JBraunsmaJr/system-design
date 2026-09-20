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
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createStoreClient, StoreClientError, type StoreClient } from './storeClient.ts';
import {
  attachExistingDevice,
  createIndexedDbDeviceKeyStorage,
  type DeviceKeyStorage,
  type EnrollmentApi,
} from './deviceIdentity.ts';
import {
  documentKeyFor,
  escrowDocumentKey,
  indexKeyFor,
  upsertEntry,
} from './workspaceDocuments.ts';
import type { DiagramFile } from '../domain/serialization.ts';

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
    version: null,
    message: null,
  });
  /** What this document needs to be saved: set once the document is known
   * to be in the workspace, cleared when it is not. */
  const tracked = useRef<{
    workspaceKey: CryptoKey;
    documentKey: string;
    wrappedDocKey: string;
  } | null>(null);
  const saving = useRef(false);
  const pending = useRef<DiagramFile | null>(null);

  const api: EnrollmentApi | null = client && {
    registerDevice: (publicKey, label) => client.registerDevice(publicKey, label),
    keysForDevice: (deviceId) => client.keysForDevice(deviceId),
    publishUserPublicKey: (publicKey) => client.publishUserPublicKey(publicKey),
    putWorkspaceKey: (generation, wrappedKey) => client.putWorkspaceKey(generation, wrappedKey),
    listDevices: () => client.listDevices(),
    approveDevice: (deviceId, code, wrapped, from) =>
      client.approveDevice(deviceId, code, wrapped, from),
    setOwnUserKey: (deviceId, wrapped) => client.setOwnUserKey(deviceId, wrapped),
  };

  /** Is this document in the workspace, and can this browser reach it? */
  const check = useCallback(async () => {
    if (!client || !api) return;
    try {
      const device = await attachExistingDevice({ api, storage });
      if (device.status !== 'ready' || !device.workspaceKey) {
        tracked.current = null;
        setState({ status: 'inactive', version: null, message: null });
        return;
      }
      const indexKey = await indexKeyFor(device.workspaceKey);
      const entry = (await client.readIndex(WORKSPACE_ID, indexKey)).entries.find(
        (candidate) => candidate.docId === docId,
      );
      if (!entry) {
        // Not in the workspace: this document is a local one, and nothing
        // should be uploaded for it.
        tracked.current = null;
        setState({ status: 'inactive', version: null, message: null });
        return;
      }
      tracked.current = {
        workspaceKey: device.workspaceKey,
        documentKey: await documentKeyFor(entry, device.workspaceKey),
        wrappedDocKey: entry.wrappedDocKey,
      };
      setState((current) => ({
        ...current,
        status: current.status === 'inactive' ? 'saved' : current.status,
        version: client.versionOf(docId),
      }));
    } catch (error) {
      tracked.current = null;
      setState({
        status:
          error instanceof StoreClientError && error.reason === 'offline' ? 'offline' : 'inactive',
        version: null,
        message: null,
      });
    }
    // api is rebuilt each render from the stable client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, docId, storage]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return check();
    });
    // A document added to the workspace starts syncing without a reload.
    const onChanged = () => void check();
    globalThis.addEventListener?.(WORKSPACE_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.(WORKSPACE_CHANGED_EVENT, onChanged);
    };
  }, [check]);

  /**
   * Saves the document as it is now. Calls that arrive while a save is in
   * flight collapse into one more save afterwards, so a burst of edits
   * costs two uploads rather than one per edit.
   */
  const saveOnce = useCallback(
    async (file: DiagramFile) => {
      const target = tracked.current;
      if (!client || !target) return;
      try {
        const recoveryPem = await client.recoveryPublicKey();
        const version = await client.putDocument(docId, target.documentKey, file, {
          wrappedForWorkspace: target.wrappedDocKey,
          ...(recoveryPem
            ? { wrappedForRecovery: await escrowDocumentKey(target.documentKey, recoveryPem) }
            : {}),
        });
        // The index carries the title, so renaming a document shows up in
        // everyone's list rather than only in the document itself.
        const indexKey = await indexKeyFor(target.workspaceKey);
        await client.updateIndex(WORKSPACE_ID, indexKey, (entries) =>
          upsertEntry(entries, {
            docId,
            wrappedDocKey: target.wrappedDocKey,
            title: file.title,
            updatedAt: new Date().toISOString(),
          }),
        );
        setState({ status: 'saved', version, message: null });
      } catch (error) {
        const offline = error instanceof StoreClientError && error.reason === 'offline';
        setState({
          status: offline ? 'offline' : 'error',
          version: client.versionOf(docId),
          message: offline
            ? 'The workspace is unreachable. Your work is saved in this browser and will go up when it returns.'
            : error instanceof StoreClientError
              ? error.message
              : String(error),
        });
      }
    },
    [client, docId],
  );

  const save = useCallback(
    async (file: DiagramFile) => {
      if (!client || !tracked.current) return;
      if (saving.current) {
        // A save is in flight: keep only the newest document, so a burst
        // of edits costs two uploads rather than one per edit.
        pending.current = file;
        return;
      }
      saving.current = true;
      setState((current) => ({ ...current, status: 'saving' }));
      // A loop rather than a recursive call: the queued document is saved
      // by this invocation, which keeps the callback a plain function.
      let next: DiagramFile | null = file;
      while (next) {
        await saveOnce(next);
        next = pending.current;
        pending.current = null;
      }
      saving.current = false;
    },
    [client, saveOnce],
  );

  return { ...state, save, refresh: check, active: state.status !== 'inactive' };
}
