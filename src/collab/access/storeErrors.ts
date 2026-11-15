/**
 * What can go wrong talking to a store, as the editor needs to tell it
 * apart. Shared by the client for workspaces (trusted/trustedStoreClient.ts)
 * and the one for sign-in and relay tokens (storeSessionClient.ts).
 */
export type StoreClientErrorReason =
  | 'unauthenticated'
  | 'not-found'
  | 'deleted'
  | 'conflict'
  | 'quota'
  | 'too-large'
  | 'offline'
  /** Signed in, and in the workspace, but this role may not do that. */
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
