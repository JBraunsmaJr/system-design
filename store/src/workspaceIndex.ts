/**
 * The workspace index (WS9-R1, R3, R5).
 *
 * One sealed blob per workspace, holding an entry per document: its id, its
 * wrapped document key, its encrypted title, and when it changed. Listing a
 * workspace is therefore one fetch and one decrypt, rather than unwrapping a
 * key per document.
 *
 * The store holds ciphertext and a version, and nothing else. It cannot
 * enumerate titles (WS9-R5), and because every write states the version it
 * builds on, two clients editing the index at once cannot silently overwrite
 * each other (WS9-R3): the second is told to re-read and retry.
 */
export interface IndexSnapshot {
  sealed: string;
  version: number;
  updatedAt: string;
  /** The workspace key generation this index is sealed under (WS7-R7). */
  generation: number;
}

export type IndexErrorReason = 'conflict' | 'not-found';

export class IndexError extends Error {
  reason: IndexErrorReason;
  /** The version the store actually holds, so a client can re-read without
   * a second request. */
  currentVersion?: number;

  constructor(message: string, reason: IndexErrorReason, currentVersion?: number) {
    super(message);
    this.name = 'IndexError';
    this.reason = reason;
    this.currentVersion = currentVersion;
  }
}

export interface WorkspaceIndexStore {
  get(workspaceId: string): Promise<IndexSnapshot | null>;
  /**
   * `expectedVersion` is the version the client read. Absent means "this
   * workspace has no index yet"; anything else is a conflict.
   */
  put(
    workspaceId: string,
    sealed: string,
    expectedVersion: number | null,
    generation?: number,
  ): Promise<IndexSnapshot>;
}

export function createMemoryWorkspaceIndex(
  now: () => Date = () => new Date(),
): WorkspaceIndexStore {
  const indexes = new Map<string, IndexSnapshot>();

  return {
    async get(workspaceId) {
      const found = indexes.get(workspaceId);
      return found ? { ...found } : null;
    },

    async put(workspaceId, sealed, expectedVersion, generation) {
      const existing = indexes.get(workspaceId);
      const current = existing?.version ?? null;
      if (current !== expectedVersion) {
        throw new IndexError(
          existing
            ? `The workspace index has moved on: you wrote against version ${expectedVersion ?? 'none'}, and it is at ${current}. Re-read it and apply your change again.`
            : `There is no index for ${workspaceId} yet; write against no version to create one.`,
          'conflict',
          current ?? undefined,
        );
      }
      const snapshot: IndexSnapshot = {
        sealed,
        version: (current ?? 0) + 1,
        updatedAt: now().toISOString(),
        generation: generation ?? existing?.generation ?? 1,
      };
      indexes.set(workspaceId, snapshot);
      return { ...snapshot };
    },
  };
}
