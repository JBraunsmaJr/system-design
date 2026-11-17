/**
 * What the editor is told about a workspace document's saving, and the
 * event that says "look again".
 */
export type WorkspaceSyncStatus =
  /** No store, or this document is not in a workspace. */
  | 'inactive'
  | 'saving'
  | 'saved'
  /** The store is unreachable. The work is still saved in this browser. */
  | 'offline'
  | 'error';

export interface WorkspaceSyncState {
  status: WorkspaceSyncStatus;
  /**
   * The live session this document belongs to, once this person is known
   * to be able to edit it: a room on the relay and the key that encrypts
   * it between browsers. Null for a local document, and for a viewer.
   */
  session: { room: string; key: string } | null;
  /** The document version the workspace last accepted. */
  version: number | null;
  message: string | null;
}

/** Told to the panel and back, so a document added to a workspace starts
 * syncing without a reload. */
export const WORKSPACE_CHANGED_EVENT = 'system-design:workspace-changed';

export function announceWorkspaceChange(): void {
  globalThis.dispatchEvent?.(new Event(WORKSPACE_CHANGED_EVENT));
}
