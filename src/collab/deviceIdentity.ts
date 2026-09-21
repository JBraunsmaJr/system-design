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
import { documentKeyFor, fromBase64, toBase64 } from './workspaceDocuments.ts';
import {
  exportPublicKey,
  publicKeyOf,
  generateWorkspaceKey,
  generateWrappingKeyPair,
  importPublicKey,
  unwrapKeyWithPrivateKey,
  unwrapPrivateKeyWithPrivateKey,
  wrapKeyForPublicKey,
  wrapPrivateKeyForPublicKey,
} from '../crypto/keys.ts';
import type { BlobContext } from '../crypto/envelope.ts';

export type EnrollmentStatus =
  /** No store configured, or not signed in. */
  | 'inactive'
  /** Registered, waiting for another device to approve this one. */
  | 'awaiting-approval'
  /** The person's first device: approved, but it has to make the keys. */
  | 'needs-setup'
  /**
   * Signed in, with a device, in a workspace that already exists and was
   * not created by them: they hold no workspace key, and a member or an
   * administrator has to give them one (WS7-R8).
   */
  | 'awaiting-access'
  /** Holds the workspace key; documents can be opened and saved. */
  | 'ready'
  | 'error';

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
  registerDevice(
    publicKey: string,
    label?: string,
  ): Promise<{ deviceId: string; verificationCode: string; approvedAt: string | null }>;
  keysForDevice(deviceId: string): Promise<
    | { status: 'awaiting-approval'; verificationCode: string }
    | { status: 'needs-setup'; verificationCode: string }
    | {
        status: 'approved';
        wrappedUserKey: { keyWrap: string; body: string };
        workspaceKeys: { generation: number; wrappedKey: string }[];
      }
  >;
  publishUserPublicKey(publicKey: string): Promise<void>;
  putWorkspaceKey(generation: number, wrappedKey: string): Promise<void>;
  listDevices(): Promise<
    {
      deviceId: string;
      verificationCode: string;
      approvedAt: string | null;
      revokedAt: string | null;
      label?: string;
    }[]
  >;
  setOwnUserKey(deviceId: string, wrappedUserKey: { keyWrap: string; body: string }): Promise<void>;
  /** Whether this workspace already holds an index - that is, whether
   * anyone has put a document in it yet. */
  workspaceExists(): Promise<boolean>;
  approveDevice(
    deviceId: string,
    verificationCode: string,
    wrappedUserKey: { keyWrap: string; body: string },
    fromDeviceId: string,
  ): Promise<void>;
}

const KEY_CONTEXT: BlobContext = { docId: 'user-key', kind: 'key-wrap', version: 1 };

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
    if (held) {
      // A device this store has never heard of: its database was
      // replaced, or this browser's key outlived the deployment that
      // issued it. Keeping it leaves the browser permanently unable to
      // enrol - it asks about a device nobody knows, gets an error, and
      // never offers to register a new one.
      const stored = held;
      const known = await api.listDevices().then(
        (devices) => devices.some((device) => device.deviceId === stored.deviceId),
        // Could not ask: assume it is fine rather than discard a good key.
        () => true,
      );
      if (!known) {
        await storage.clear();
        held = null;
      }
    }
    if (!held) {
      // Non-extractable: this key is the anchor of the browser's access and
      // must never be copied anywhere, not even by this code.
      const keyPair = await generateWrappingKeyPair('device');
      const registered = await api.registerDevice(
        toBase64(await exportPublicKey(keyPair.publicKey)),
        options.label,
      );
      await storage.save(registered.deviceId, keyPair);
      held = { deviceId: registered.deviceId, keyPair };
    }

    const keys = await api.keysForDevice(held.deviceId);
    if (keys.status === 'needs-setup') {
      // Approved and holding no user key. Either this is the person's
      // first device, which has to make the keys, or they have joined a
      // workspace someone else created and are waiting to be let in.
      const exists = await api.workspaceExists().catch(() => false);
      if (!exists) {
        return {
          status: 'needs-setup',
          deviceId: held.deviceId,
          verificationCode: keys.verificationCode,
          workspaceKey: null,
        };
      }
      // Waiting to be let in, so publish what someone needs in order to
      // let them in. Without this a new member appears in the workspace
      // with nothing to wrap the key to, and the person who could grant
      // it sees a button they cannot press - which is what happened.
      await publishIdentity(options, held);
      return {
        status: 'awaiting-access',
        deviceId: held.deviceId,
        verificationCode: keys.verificationCode,
        workspaceKey: null,
        message: 'Waiting for someone in this workspace to give you access.',
      };
    }
    if (keys.status === 'awaiting-approval') {
      return {
        status: keys.status,
        deviceId: held.deviceId,
        verificationCode: keys.verificationCode,
        workspaceKey: null,
      };
    }

    const userKey = await unwrapPrivateKeyWithPrivateKey(
      {
        keyWrap: fromBase64(keys.wrappedUserKey.keyWrap),
        body: fromBase64(keys.wrappedUserKey.body),
      },
      held.keyPair.privateKey,
      KEY_CONTEXT,
    );
    const newest = [...keys.workspaceKeys].sort((a, b) => b.generation - a.generation)[0];
    if (!newest) {
      // Has keys of their own, holds no workspace key: waiting, not
      // broken. Their public key is republished in case it was never
      // stored, so whoever can grant access has something to wrap to.
      await api
        .publishUserPublicKey(toBase64(await exportPublicKey(await publicKeyOf(userKey))))
        .catch(() => {
          // Already published, or the store refused: the waiting state is
          // reported either way.
        });
      return {
        status: 'awaiting-access',
        deviceId: held.deviceId,
        verificationCode: null,
        workspaceKey: null,
        message: 'Waiting for someone in this workspace to give you access.',
      };
    }
    const workspaceKey = await unwrapKeyWithPrivateKey(
      fromBase64(newest.wrappedKey),
      userKey,
      'AES-KW',
    );
    return { status: 'ready', deviceId: held.deviceId, verificationCode: null, workspaceKey };
  } catch (error) {
    return {
      status: 'error',
      deviceId: null,
      verificationCode: null,
      workspaceKey: null,
      message: String(error),
    };
  }
}

/**
 * The first browser: makes the user key and the workspace key, seals the
 * user key to this device, and publishes the public halves. Only valid where
 * the person has no other device - otherwise their existing devices would be
 * left holding a key nothing uses.
 */
/**
 * Like enrollDevice, but never registers: it reports what this browser
 * already has. Background work uses this, so that saving in the
 * background can never create a second device for someone who has not
 * enrolled this browser yet.
 */
export async function attachExistingDevice(options: EnrollOptions): Promise<DeviceState> {
  const held = await options.storage.load();
  if (!held)
    return { status: 'inactive', deviceId: null, verificationCode: null, workspaceKey: null };
  return enrollDevice(options);
}

/**
 * Makes this person's user key, seals it to this device, and publishes
 * its public half - everything needed for someone else to wrap the
 * workspace key to them (WS7-R8). Once done, the device holds a wrapped
 * user key, so a later call takes the approved path instead.
 */
async function publishIdentity(
  options: EnrollOptions,
  device: { deviceId: string; keyPair: CryptoKeyPair },
): Promise<CryptoKey> {
  const userKeyPair = await generateWrappingKeyPair('user');
  const wrapped = await wrapPrivateKeyForPublicKey(
    userKeyPair.privateKey,
    device.keyPair.publicKey,
    KEY_CONTEXT,
  );
  await options.api.setOwnUserKey(device.deviceId, {
    keyWrap: toBase64(wrapped.keyWrap),
    body: toBase64(wrapped.body),
  });
  await options.api.publishUserPublicKey(toBase64(await exportPublicKey(userKeyPair.publicKey)));
  return userKeyPair.privateKey;
}

export async function bootstrapFirstDevice(options: EnrollOptions): Promise<DeviceState> {
  const { api, storage } = options;
  // A workspace that already holds documents has a key. Minting a second
  // one would leave this person unable to read anything already there,
  // and writing documents nobody else can read. They publish their public
  // key and wait to be given the existing key instead (WS7-R8).
  if (await api.workspaceExists().catch(() => false)) {
    const device = (await storage.load()) ?? (await registerHere(options));
    const userKeyPair = await generateWrappingKeyPair('user');
    const wrapped = await wrapPrivateKeyForPublicKey(
      userKeyPair.privateKey,
      device.keyPair.publicKey,
      KEY_CONTEXT,
    );
    await api.setOwnUserKey(device.deviceId, {
      keyWrap: toBase64(wrapped.keyWrap),
      body: toBase64(wrapped.body),
    });
    await api.publishUserPublicKey(toBase64(await exportPublicKey(userKeyPair.publicKey)));
    return {
      status: 'awaiting-access',
      deviceId: device.deviceId,
      verificationCode: null,
      workspaceKey: null,
      message:
        'Your account is ready. A workspace member or an administrator has to give you access to the workspace.',
    };
  }
  const existing = await api.listDevices();
  const others = existing.filter((device) => !device.revokedAt);
  const held = await storage.load();
  if (others.some((device) => device.deviceId !== held?.deviceId && device.approvedAt)) {
    return {
      status: 'awaiting-approval',
      deviceId: held?.deviceId ?? null,
      verificationCode: held
        ? (existing.find((d) => d.deviceId === held.deviceId)?.verificationCode ?? null)
        : null,
      workspaceKey: null,
      message:
        'Another device already holds your keys. Approve this one from it, or use your recovery code.',
    };
  }

  const device = held ?? (await registerHere(options));
  const userKeyPair = await generateWrappingKeyPair('user');
  const workspaceKey = await generateWorkspaceKey();

  // The user key, sealed to this device, so the next visit can reach it.
  // Not an approval: the first device is approved as it registers, since
  // there is nothing that could approve it.
  const wrapped = await wrapPrivateKeyForPublicKey(
    userKeyPair.privateKey,
    device.keyPair.publicKey,
    KEY_CONTEXT,
  );
  await api.setOwnUserKey(device.deviceId, {
    keyWrap: toBase64(wrapped.keyWrap),
    body: toBase64(wrapped.body),
  });
  await api.publishUserPublicKey(toBase64(await exportPublicKey(userKeyPair.publicKey)));
  await api.putWorkspaceKey(
    1,
    toBase64(await wrapKeyForPublicKey(workspaceKey, userKeyPair.publicKey)),
  );
  return { status: 'ready', deviceId: device.deviceId, verificationCode: null, workspaceKey };
}

async function registerHere(
  options: EnrollOptions,
): Promise<{ deviceId: string; keyPair: CryptoKeyPair }> {
  const keyPair = await generateWrappingKeyPair('device');
  const registered = await options.api.registerDevice(
    toBase64(await exportPublicKey(keyPair.publicKey)),
    options.label,
  );
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
export function createIndexedDbDeviceKeyStorage(
  databaseName = 'system-design:device',
): DeviceKeyStorage {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  return {
    async load() {
      const db = await open();
      try {
        return await new Promise((resolve, reject) => {
          const get = db.transaction('keys').objectStore('keys').get('device');
          get.onsuccess = () =>
            resolve(
              (get.result as { deviceId: string; keyPair: CryptoKeyPair } | undefined) ?? null,
            );
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
          const tx = db.transaction('keys', 'readwrite');
          tx.objectStore('keys').put({ deviceId, keyPair }, 'device');
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
          const tx = db.transaction('keys', 'readwrite');
          tx.objectStore('keys').delete('device');
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
