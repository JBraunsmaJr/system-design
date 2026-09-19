/**
 * This browser's identity to the store (WS7-R8, R11, R12, R14).
 *
 * A browser holds a device keypair whose private half never leaves it, and
 * reaches the workspace key through it:
 *
 * ```
 *   device key (here, non-extractable)
 *     unwraps → user key       (wrapped to this device by another device)
 *     unwraps → workspace key  (wrapped to the user key)
 *     unwraps → document keys  (from the workspace index)
 * ```
 *
 * The first browser a person uses has nothing to unwrap: it generates the
 * user key and the workspace key itself, and its device is approved as it
 * registers. Every later browser registers, shows a verification code, and
 * waits until an approved one hands it the user key.
 *
 * Key storage is injected so this can be tested outside a browser; in a
 * browser it is IndexedDB, holding non-extractable CryptoKeys that cannot be
 * read out even by this application.
 */
import {
  documentKeyFor,
  fromBase64,
  toBase64,
} from "./workspaceDocuments.ts";
import {
  exportPublicKey,
  generateWorkspaceKey,
  generateWrappingKeyPair,
  importPublicKey,
  unwrapKeyWithPrivateKey,
  unwrapPrivateKeyWithPrivateKey,
  wrapKeyForPublicKey,
  wrapPrivateKeyForPublicKey,
} from "../crypto/keys.ts";
import type { BlobContext } from "../crypto/envelope.ts";

export type EnrollmentStatus =
  /** No store configured, or not signed in. */
  | "inactive"
  /** Registered, waiting for another device to approve this one. */
  | "awaiting-approval"
  /** Holds the workspace key; documents can be opened and saved. */
  | "ready"
  | "error";

export interface DeviceState {
  status: EnrollmentStatus;
  deviceId: string | null;
  /** Shown here and on the approving device; they must match (WS7-R11). */
  verificationCode: string | null;
  workspaceKey: CryptoKey | null;
  message?: string;
}

/** Where the device keypair lives between visits. */
export interface DeviceKeyStorage {
  load(): Promise<{ deviceId: string; keyPair: CryptoKeyPair } | null>;
  save(deviceId: string, keyPair: CryptoKeyPair): Promise<void>;
  clear(): Promise<void>;
}

/** The store operations enrolment needs. */
export interface EnrollmentApi {
  registerDevice(publicKey: string, label?: string): Promise<{ deviceId: string; verificationCode: string; approvedAt: string | null }>;
  keysForDevice(deviceId: string): Promise<
    | { status: "awaiting-approval"; verificationCode: string }
    | { status: "approved"; wrappedUserKey: { keyWrap: string; body: string }; workspaceKeys: { generation: number; wrappedKey: string }[] }
  >;
  publishUserPublicKey(publicKey: string): Promise<void>;
  putWorkspaceKey(generation: number, wrappedKey: string): Promise<void>;
  listDevices(): Promise<{ deviceId: string; verificationCode: string; approvedAt: string | null; revokedAt: string | null; label?: string }[]>;
  setOwnUserKey(deviceId: string, wrappedUserKey: { keyWrap: string; body: string }): Promise<void>;
  approveDevice(deviceId: string, verificationCode: string, wrappedUserKey: { keyWrap: string; body: string }, fromDeviceId: string): Promise<void>;
}

const KEY_CONTEXT: BlobContext = { docId: "user-key", kind: "key-wrap", version: 1 };

export interface EnrollOptions {
  api: EnrollmentApi;
  storage: DeviceKeyStorage;
  label?: string;
}

/**
 * Brings this browser to a usable state, or reports what it is waiting for.
 * Safe to call repeatedly: it reuses the device it already has.
 */
export async function enrollDevice(options: EnrollOptions): Promise<DeviceState> {
  const { api, storage } = options;
  try {
    let held = await storage.load();
    if (!held) {
      // Non-extractable: this key is the anchor of the browser's access and
      // must never be copied anywhere, not even by this code.
      const keyPair = await generateWrappingKeyPair("device");
      const registered = await api.registerDevice(toBase64(await exportPublicKey(keyPair.publicKey)), options.label);
      await storage.save(registered.deviceId, keyPair);
      held = { deviceId: registered.deviceId, keyPair };
    }

    const keys = await api.keysForDevice(held.deviceId);
    if (keys.status === "awaiting-approval") {
      return { status: "awaiting-approval", deviceId: held.deviceId, verificationCode: keys.verificationCode, workspaceKey: null };
    }

    const userKey = await unwrapPrivateKeyWithPrivateKey(
      { keyWrap: fromBase64(keys.wrappedUserKey.keyWrap), body: fromBase64(keys.wrappedUserKey.body) },
      held.keyPair.privateKey,
      KEY_CONTEXT,
    );
    const newest = [...keys.workspaceKeys].sort((a, b) => b.generation - a.generation)[0];
    if (!newest) {
      return {
        status: "error",
        deviceId: held.deviceId,
        verificationCode: null,
        workspaceKey: null,
        message: "This device is approved, but no workspace key has been shared with you yet. An administrator can grant one.",
      };
    }
    const workspaceKey = await unwrapKeyWithPrivateKey(fromBase64(newest.wrappedKey), userKey, "AES-KW");
    return { status: "ready", deviceId: held.deviceId, verificationCode: null, workspaceKey };
  } catch (error) {
    return { status: "error", deviceId: null, verificationCode: null, workspaceKey: null, message: String(error) };
  }
}

/**
 * The first browser: makes the user key and the workspace key, seals the
 * user key to this device, and publishes the public halves. Only valid where
 * the person has no other device - otherwise their existing devices would be
 * left holding a key nothing uses.
 */
export async function bootstrapFirstDevice(options: EnrollOptions): Promise<DeviceState> {
  const { api, storage } = options;
  const existing = await api.listDevices();
  const others = existing.filter((device) => !device.revokedAt);
  const held = await storage.load();
  if (others.some((device) => device.deviceId !== held?.deviceId && device.approvedAt)) {
    return {
      status: "awaiting-approval",
      deviceId: held?.deviceId ?? null,
      verificationCode: held ? (existing.find((d) => d.deviceId === held.deviceId)?.verificationCode ?? null) : null,
      workspaceKey: null,
      message: "Another device already holds your keys. Approve this one from it, or use your recovery code.",
    };
  }

  const device = held ?? (await registerHere(options));
  const userKeyPair = await generateWrappingKeyPair("user");
  const workspaceKey = await generateWorkspaceKey();

  // The user key, sealed to this device, so the next visit can reach it.
  // Not an approval: the first device is approved as it registers, since
  // there is nothing that could approve it.
  const wrapped = await wrapPrivateKeyForPublicKey(userKeyPair.privateKey, device.keyPair.publicKey, KEY_CONTEXT);
  await api.setOwnUserKey(device.deviceId, { keyWrap: toBase64(wrapped.keyWrap), body: toBase64(wrapped.body) });
  await api.publishUserPublicKey(toBase64(await exportPublicKey(userKeyPair.publicKey)));
  await api.putWorkspaceKey(1, toBase64(await wrapKeyForPublicKey(workspaceKey, userKeyPair.publicKey)));
  return { status: "ready", deviceId: device.deviceId, verificationCode: null, workspaceKey };
}

async function registerHere(options: EnrollOptions): Promise<{ deviceId: string; keyPair: CryptoKeyPair }> {
  const keyPair = await generateWrappingKeyPair("device");
  const registered = await options.api.registerDevice(toBase64(await exportPublicKey(keyPair.publicKey)), options.label);
  await options.storage.save(registered.deviceId, keyPair);
  return { deviceId: registered.deviceId, keyPair };
}

/**
 * Approving another browser from this one (WS7-R11). The code shown here
 * must match the code shown there; the store recomputes it from the public
 * key it holds, so a substituted key is refused.
 */
export async function approveOtherDevice(
  options: EnrollOptions & { thisDeviceId: string; userKey: CryptoKey },
  target: { deviceId: string; publicKey: string; verificationCode: string },
): Promise<void> {
  const wrapped = await wrapPrivateKeyForPublicKey(
    options.userKey,
    await importPublicKey(fromBase64(target.publicKey)),
    KEY_CONTEXT,
  );
  await options.api.approveDevice(
    target.deviceId,
    target.verificationCode,
    { keyWrap: toBase64(wrapped.keyWrap), body: toBase64(wrapped.body) },
    options.thisDeviceId,
  );
}

/** For tests, and for a browser without IndexedDB. Keys live for this visit. */
export function createMemoryDeviceKeyStorage(): DeviceKeyStorage {
  let held: { deviceId: string; keyPair: CryptoKeyPair } | null = null;
  return {
    async load() {
      return held;
    },
    async save(deviceId, keyPair) {
      held = { deviceId, keyPair };
    },
    async clear() {
      held = null;
    },
  };
}

/**
 * The browser's own store: IndexedDB holds CryptoKey objects directly, so a
 * non-extractable private key is kept without this application ever being
 * able to read its bytes.
 */
export function createIndexedDbDeviceKeyStorage(databaseName = "system-design:device"): DeviceKeyStorage {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  return {
    async load() {
      const db = await open();
      try {
        return await new Promise((resolve, reject) => {
          const get = db.transaction("keys").objectStore("keys").get("device");
          get.onsuccess = () => resolve((get.result as { deviceId: string; keyPair: CryptoKeyPair } | undefined) ?? null);
          get.onerror = () => reject(get.error);
        });
      } finally {
        db.close();
      }
    },
    async save(deviceId, keyPair) {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("keys", "readwrite");
          tx.objectStore("keys").put({ deviceId, keyPair }, "device");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    async clear() {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("keys", "readwrite");
          tx.objectStore("keys").delete("device");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
  };
}

export { documentKeyFor };
