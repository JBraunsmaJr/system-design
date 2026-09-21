import {
  bootstrapFirstDevice,
  createIndexedDbDeviceKeyStorage,
  enrollDevice,
  type DeviceKeyStorage,
  type EnrollmentApi,
} from './deviceIdentity.ts';
import {
  documentKeyFor,
  escrowDocumentKey,
  indexKeyFor,
  newDocumentKey,
  upsertEntry,
} from './workspaceDocuments.ts';
import { announceWorkspaceChange } from './useWorkspaceSync.ts';
import type { IndexEntry, StoreClient } from './storeClient.ts';

export interface SaveDocumentToWorkspaceOptions {
  client: StoreClient;
  storage?: DeviceKeyStorage;
  docId: string;
  title: string;
  documentState: Uint8Array;
  workspaceId?: string;
  label?: string;
}

/**
 * Persists a document and its current state to the workspace store (WS8-R2).
 *
 * Enrolls or bootstraps the current device if needed, creates or updates
 * the document in the store with encrypted CRDT update data, and updates
 * the workspace index.
 */
export async function saveDocumentToWorkspace(
  options: SaveDocumentToWorkspaceOptions,
): Promise<IndexEntry[]> {
  const { client, docId, title, documentState } = options;
  const storage = options.storage ?? createIndexedDbDeviceKeyStorage();
  const workspaceId = options.workspaceId ?? 'default';
  const label =
    options.label ??
    (typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 60) : 'Browser');

  const api: EnrollmentApi = {
    registerDevice: (publicKey, lbl) => client.registerDevice(publicKey, lbl),
    keysForDevice: (deviceId) => client.keysForDevice(deviceId),
    publishUserPublicKey: (publicKey) => client.publishUserPublicKey(publicKey),
    putWorkspaceKey: (generation, wrappedKey) => client.putWorkspaceKey(generation, wrappedKey),
    listDevices: () => client.listDevices(),
    approveDevice: (deviceId, code, wrapped, from) =>
      client.approveDevice(deviceId, code, wrapped, from),
    setOwnUserKey: (deviceId, wrapped) => client.setOwnUserKey(deviceId, wrapped),
    workspaceExists: () => client.workspaceExists(workspaceId),
  };

  let deviceState = await enrollDevice({
    api,
    storage,
    label,
  });

  if (deviceState.status === 'needs-setup') {
    deviceState = await bootstrapFirstDevice({
      api,
      storage,
      label,
    });
  }

  if (deviceState.status !== 'ready' || !deviceState.workspaceKey) {
    throw new Error(deviceState.message ?? 'This browser cannot write to the workspace yet.');
  }

  const workspaceKey = deviceState.workspaceKey;
  const indexKey = await indexKeyFor(workspaceKey);
  const currentIndex = await client.readIndex(workspaceId, indexKey);
  const existing = currentIndex.entries.find((entry) => entry.docId === docId);
  const keys = existing
    ? {
        documentKey: await documentKeyFor(existing, workspaceKey),
        wrappedDocKey: existing.wrappedDocKey,
      }
    : await newDocumentKey(workspaceKey);

  if (!existing) {
    const recoveryPem = await client.recoveryPublicKey();
    const version = await client.createDocument(docId, {
      wrappedForWorkspace: keys.wrappedDocKey,
      ...(recoveryPem
        ? { wrappedForRecovery: await escrowDocumentKey(keys.documentKey, recoveryPem) }
        : {}),
    });
    await client.appendUpdate(docId, keys.documentKey, documentState, version);
  }

  const next = await client.updateIndex(workspaceId, indexKey, (current) =>
    upsertEntry(current, {
      docId,
      wrappedDocKey: keys.wrappedDocKey,
      title,
      updatedAt: new Date().toISOString(),
    }),
  );

  announceWorkspaceChange();
  return next;
}
