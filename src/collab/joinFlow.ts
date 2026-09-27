/**
 * The newcomer's side of automatic access (WS14-R2, R14, R38).
 *
 * The provider signs the nonce into the ID token, so the key the nonce
 * commits to has to exist before the browser is sent to sign in. This module
 * makes that key (or picks up the one already published), remembers it with
 * its salt across the redirect, hands the key to enrolment so the same key is
 * the one published, and finally asks the store to open a join request.
 *
 * Everything here degrades to today's behaviour: a store without automatic
 * access, a GitHub sign-in, or any failure preparing a commitment simply
 * means a plain sign-in and a manual grant.
 */
import { exportPublicKey, generateWrappingKeyPair } from '../crypto/keys.ts';
import { joinCommitment, newJoinSalt } from '../crypto/joinCommitment.ts';
import { StoreClientError, createStoreClient, type StoreClient } from './storeClient.ts';
import { toBase64 } from './workspaceDocuments.ts';

/** What survives the redirect to the provider and back. */
export interface PendingJoin {
  salt: Uint8Array;
  /** SPKI committed to. */
  publicKey: Uint8Array;
  /** The user key pair, when this browser made it for the sign-in. Null when
   * the commitment is to a key already published from elsewhere. */
  userKeyPair: CryptoKeyPair | null;
  createdAt: number;
}

export interface PendingJoinStorage {
  load(): Promise<PendingJoin | null>;
  save(pending: PendingJoin): Promise<void>;
  clear(): Promise<void>;
}

/** A pending key older than this is not reused: a fresh sign-in makes a
 * fresh one rather than resurrecting something from weeks ago. */
const PENDING_KEY_REUSE_MS = 24 * 60 * 60 * 1000;

/**
 * Prepares a sign-in that can back a join request: returns the commitment to
 * send as `?commitment=`. With `publishedPublicKey` it commits to that key -
 * the person already has one, and signing in again (their evidence expired,
 * WS14-R38) must not replace it. Otherwise it makes the user key now.
 */
export async function prepareJoinSignIn(
  storage: PendingJoinStorage,
  options: { publishedPublicKey?: Uint8Array; now?: () => number } = {},
): Promise<string> {
  const now = options.now ?? Date.now;
  let userKeyPair: CryptoKeyPair | null = null;
  let publicKey: Uint8Array;
  if (options.publishedPublicKey) {
    publicKey = options.publishedPublicKey;
  } else {
    const previous = await storage.load().catch(() => null);
    userKeyPair =
      previous?.userKeyPair && now() - previous.createdAt < PENDING_KEY_REUSE_MS
        ? previous.userKeyPair
        : await generateWrappingKeyPair('user');
    publicKey = await exportPublicKey(userKeyPair.publicKey);
  }
  const salt = newJoinSalt();
  await storage.save({ salt, publicKey, userKeyPair, createdAt: now() });
  return joinCommitment(publicKey, salt);
}

/**
 * Where to send the browser to sign in. Asks for a commitment only where it
 * can do some good - automatic access is on and the provider is OIDC - and
 * falls back to a plain sign-in on any failure, since signing in must never
 * depend on this feature working.
 */
export async function signInUrlFor(options: {
  client: Pick<StoreClient, 'providerDetails' | 'signInUrl'>;
  provider: string;
  storage: PendingJoinStorage;
  publishedPublicKey?: Uint8Array;
}): Promise<string> {
  try {
    const { providers, autoAccess } = await options.client.providerDetails();
    const kind = providers.find((provider) => provider.id === options.provider)?.kind;
    if (autoAccess && kind === 'oidc') {
      const commitment = await prepareJoinSignIn(options.storage, {
        publishedPublicKey: options.publishedPublicKey,
      });
      return options.client.signInUrl(options.provider, commitment);
    }
  } catch {
    // Fall through to a plain sign-in.
  }
  return options.client.signInUrl(options.provider);
}

/**
 * Sends this browser to sign in (WS10-R1), committing to a key where that
 * can back a join request. A full navigation: the store is the OAuth client
 * and the session comes back as a cookie.
 */
export async function startSignIn(
  storeUrl: string,
  provider: string,
  options: { publishedPublicKey?: Uint8Array; storage?: PendingJoinStorage } = {},
): Promise<void> {
  const url = await signInUrlFor({
    client: createStoreClient({ baseUrl: storeUrl }),
    provider,
    storage: options.storage ?? defaultPendingJoinStorage(),
    publishedPublicKey: options.publishedPublicKey,
  });
  globalThis.location.assign(url);
}

/** IndexedDB where there is one; otherwise this visit's memory, which is
 * as good as nothing across a redirect - and so a plain sign-in. */
export function defaultPendingJoinStorage(): PendingJoinStorage {
  return typeof indexedDB === 'undefined'
    ? createMemoryPendingJoinStorage()
    : createIndexedDbPendingJoinStorage();
}

/**
 * For enrolment (EnrollOptions.userKeySource): the user key made for this
 * sign-in, so the key published is the key the token vouches for. Null when
 * there is none, and enrolment makes one as it always has.
 */
export function pendingUserKeySource(storage: PendingJoinStorage, now: () => number = Date.now) {
  return async (): Promise<CryptoKeyPair | null> => {
    const pending = await storage.load().catch(() => null);
    if (!pending?.userKeyPair) return null;
    // The same limit as reuse at sign-in: a key prepared long ago is not
    // quietly published now.
    if (now() - pending.createdAt >= PENDING_KEY_REUSE_MS) return null;
    return pending.userKeyPair;
  };
}

/**
 * Once enrolment has wrapped the committed key to this device and published
 * it, the pending record no longer needs the private key: this browser holds
 * it properly now. Drops it, keeping the salt and public key the join
 * request still needs.
 */
export async function releasePendingUserKey(storage: PendingJoinStorage): Promise<void> {
  const pending = await storage.load().catch(() => null);
  if (pending?.userKeyPair) await storage.save({ ...pending, userKeyPair: null });
}

export type JoinSubmission =
  | { status: 'sent'; requests: { workspaceId: string; status: string }[]; reason?: string }
  /** This sign-in made no commitment: sign in again from the editor. */
  | { status: 'no-evidence' }
  /** Nothing was prepared in this browser before signing in. */
  | { status: 'nothing-pending' }
  /** The published key is not the one committed to (another browser
   * published first); signing in again commits to the published one. */
  | { status: 'key-mismatch' }
  /** The store does not offer automatic access. */
  | { status: 'unsupported' };

/**
 * After enrolment has published the user key: opens the join request. Clears
 * the pending record once the store has it, so no extractable private key
 * lingers in this browser's storage longer than needed.
 */
export async function submitJoinRequest(
  client: Pick<StoreClient, 'session' | 'me' | 'requestToJoin'>,
  storage: PendingJoinStorage,
): Promise<JoinSubmission> {
  try {
    const session = await client.session();
    if (!session?.hasEvidence) return { status: 'no-evidence' };
    const pending = await storage.load();
    if (!pending) {
      await storage.clear();
      return { status: 'nothing-pending' };
    }
    const me = await client.me();
    if (me.publicKey !== toBase64(pending.publicKey)) {
      // This record can never be used: the key it commits to is not the
      // one published. A fresh sign-in makes a new one.
      await storage.clear();
      return { status: 'key-mismatch' };
    }
    const result = await client.requestToJoin(pending.salt);
    await storage.clear();
    return { status: 'sent', ...result };
  } catch (error) {
    if (error instanceof StoreClientError && error.status === 404) {
      await storage.clear().catch(() => {});
      return { status: 'unsupported' };
    }
    throw error;
  }
}

export function createMemoryPendingJoinStorage(): PendingJoinStorage {
  let held: PendingJoin | null = null;
  return {
    async load() {
      return held;
    },
    async save(pending) {
      held = pending;
    },
    async clear() {
      held = null;
    },
  };
}

/** IndexedDB, which keeps CryptoKey objects across the redirect without
 * this code ever reading their bytes. */
export function createIndexedDbPendingJoinStorage(
  databaseName = 'system-design:pending-join',
): PendingJoinStorage {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest | void,
  ): Promise<T | undefined> => {
    const db = await open();
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction('pending', mode);
        const request = work(tx.objectStore('pending'));
        tx.oncomplete = () => resolve(request ? (request.result as T) : undefined);
        tx.onerror = () => reject(tx.error);
        // A transaction aborted on its own - explicitly, or by the browser
        // for quota or shutdown - fires only this. Without it the promise
        // would never settle, and sign-in would hang instead of falling
        // back to a plain sign-in. (Rejecting twice is harmless.)
        tx.onabort = () =>
          reject(tx.error ?? new Error('The browser storage transaction was aborted.'));
      });
    } finally {
      db.close();
    }
  };
  return {
    async load() {
      return (await run<PendingJoin>('readonly', (store) => store.get('join'))) ?? null;
    },
    async save(pending) {
      await run('readwrite', (store) => {
        store.put(pending, 'join');
      });
    },
    async clear() {
      await run('readwrite', (store) => {
        store.delete('join');
      });
    },
  };
}
