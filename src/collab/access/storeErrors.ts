/**
 * What can go wrong talking to a store, as the editor needs to tell it
 * apart. Shared by the client for the key-based API (storeClient.ts) and the
 * one for the workspace API (trusted/trustedStoreClient.ts), so code that
 * reacts to "offline" or "conflict" does not care which it is talking to.
 */
export type StoreClientErrorReason =
  | 'unauthenticated'
  | 'not-found'
  | 'deleted'
  | 'conflict'
  | 'rolled-back'
  | 'quota'
  | 'too-large'
  | 'offline'
  | 'unreadable'
  /** WS14-R31: this person was removed from the workspace. */
  | 'removed'
  /** The workspace API: signed in, and in the workspace, but this role may
   * not do that. */
  | 'forbidden'
  | 'store-error';

export class StoreClientError extends Error {
  reason: StoreClientErrorReason;
  status?: number;

  constructor(message: string, reason: StoreClientErrorReason, status?: number) {
    super(message);
    this.name = 'StoreClientError';
    this.reason = reason;
    this.status = status;
  }
}
