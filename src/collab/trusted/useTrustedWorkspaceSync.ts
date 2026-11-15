/**
 * Keeping the open document in step with a trusted store (the workspace
 * API, /v2).
 *
 * The same job useWorkspaceSync does for the key-based API, without the
 * keys: if the store has this document and this person may see it, its
 * CRDT updates go up as they happen and other people's come down, so two
 * editors merge rather than overwrite (documentSync.ts). Whether the store
 * has it is the store's answer alone - there is no local list to consult -
 * so a document added to a workspace elsewhere starts syncing the next time
 * this is checked.
 *
 * Someone with the viewer role follows the document without sending
 * anything: the store would refuse their changes, so they stay in this
 * browser and `readOnly` says so.
 *
 * Returns the same shape as useWorkspaceSync, so the durability indicator
 * and the unload guard work with either.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { StoreClientError } from '../access/storeErrors.ts';
import { DEFAULT_DOCUMENT_ID } from '../../domain/storage/currentDocument.ts';
import { WORKSPACE_CHANGED_EVENT, type WorkspaceSyncState } from '../hooks/useWorkspaceSync.ts';
import { createDocumentSync, type DocumentSync } from '../sync/documentSync.ts';
import {
  createTrustedStoreClient,
  type TrustedStoreClient,
  type TrustedWorkspace,
} from './trustedStoreClient.ts';

export interface TrustedWorkspaceSyncOptions {
  /** Null when there is no trusted store: the hook then does nothing. */
  storeUrl: string | null;
  docId: string;
  /** The open document. Its updates are what the workspace holds. */
  doc: Y.Doc;
  /** Kept in the store's catalog, so renaming shows in everyone's list. */
  title: string;
  client?: TrustedStoreClient;
}

export interface TrustedWorkspaceSyncState extends WorkspaceSyncState {
  /** The workspace this document is in, with this person's role there. */
  workspace: Pick<TrustedWorkspace, 'workspaceId' | 'name' | 'role'> | null;
  /** This person may read the document but not change it. */
  readOnly: boolean;
}

const INACTIVE: TrustedWorkspaceSyncState = {
  status: 'inactive',
  session: null,
  version: null,
  message: null,
  workspace: null,
  readOnly: false,
};

export function useTrustedWorkspaceSync(options: TrustedWorkspaceSyncOptions) {
  const { storeUrl, docId, doc } = options;
  const [client] = useState<TrustedStoreClient | null>(
    () => options.client ?? (storeUrl ? createTrustedStoreClient({ baseUrl: storeUrl }) : null),
  );
  const [state, setState] = useState<TrustedWorkspaceSyncState>(INACTIVE);
  /** Running while this document is in a workspace. */
  const sync = useRef<DocumentSync | null>(null);
  /** The title the store's catalog holds, once known. */
  const storedTitle = useRef<string | null>(null);
  const canWrite = useRef(false);

  const stop = useCallback(() => {
    sync.current?.stop();
    sync.current = null;
    storedTitle.current = null;
    canWrite.current = false;
  }, []);

  /** Is this document in a workspace this person can see? */
  const check = useCallback(async () => {
    // A browser's first document has the same id in every browser. It is
    // never a workspace document, whatever a store may hold under that id:
    // treating it as one would merge everyone's own first document together.
    if (!client || docId === DEFAULT_DOCUMENT_ID) return;
    try {
      const found = await client.findDocument(docId);
      if (!found) {
        // A local document, or one in a workspace this person is not in.
        stop();
        setState(INACTIVE);
        return;
      }
      if (sync.current) return;
      const mine = (await client.listWorkspaces()).find(
        (candidate) => candidate.workspaceId === found.workspaceId,
      );
      const workspace = mine
        ? { workspaceId: mine.workspaceId, name: mine.name, role: mine.role }
        : null;
      const readOnly = !mine || mine.role === 'viewer';
      const started = createDocumentSync({
        log: client.documentLog(docId),
        doc,
        readOnly,
        onStatus: (status, detail) =>
          setState({
            status: status === 'starting' ? 'saving' : status,
            // Live sessions through the relay are not part of this API yet.
            session: null,
            version: started.version(),
            message:
              detail ??
              (readOnly
                ? 'You can view this document. Changes you make here are not saved to the workspace.'
                : null),
            workspace,
            readOnly,
          }),
      });
      await started.start();
      sync.current = started;
      storedTitle.current = found.title;
      canWrite.current = !readOnly;
    } catch (error) {
      stop();
      const offline = error instanceof StoreClientError && error.reason === 'offline';
      const deleted = error instanceof StoreClientError && error.reason === 'deleted';
      setState({
        ...INACTIVE,
        status: offline ? 'offline' : 'inactive',
        message: deleted
          ? 'This document was deleted from its workspace. Your copy in this browser is unaffected.'
          : null,
      });
    }
  }, [client, docId, doc, stop]);

  // A page going away sends what is outstanding in a request that may
  // outlive it; see useWorkspaceSync for why both events are listened for.
  useEffect(() => {
    const leaving = () => sync.current?.flushOnExit();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leaving();
    };
    globalThis.addEventListener?.('pagehide', leaving);
    document.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      globalThis.removeEventListener?.('pagehide', leaving);
      document.removeEventListener?.('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return check();
    });
    const onChanged = () => void check();
    globalThis.addEventListener?.(WORKSPACE_CHANGED_EVENT, onChanged);
    // Whether this document is in a workspace can change somewhere else:
    // a colleague restores it after deleting it, or adds this person to its
    // workspace. Nothing tells this tab, so it looks again when someone
    // comes back to it - but only while it is not syncing, when there is
    // something to find out.
    const onReturn = () => {
      if (!sync.current && document.visibilityState !== 'hidden') void check();
    };
    globalThis.addEventListener?.('focus', onReturn);
    document.addEventListener?.('visibilitychange', onReturn);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.(WORKSPACE_CHANGED_EVENT, onChanged);
      globalThis.removeEventListener?.('focus', onReturn);
      document.removeEventListener?.('visibilitychange', onReturn);
      stop();
    };
  }, [client, check, stop]);

  /**
   * The title, which the catalog carries so a workspace's documents can be
   * listed without opening them. Written a moment after it settles, and
   * only once the document's own content has arrived: a browser opening a
   * workspace document for the first time holds a placeholder title until
   * then, and must not publish it.
   */
  const title = options.title;
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = async (): Promise<void> => {
      if (cancelled) return;
      if (!sync.current || storedTitle.current === null) {
        // Not attached yet. Look again shortly.
        timer = setTimeout(() => void attempt(), 2000);
        return;
      }
      if (!canWrite.current || title.trim() === '' || title === storedTitle.current) return;
      try {
        storedTitle.current = (await client.retitleDocument(docId, title)).title;
      } catch (error) {
        console.warn('Could not update the document title in the workspace:', error);
        if (!cancelled) timer = setTimeout(() => void attempt(), 5000);
      }
    };
    timer = setTimeout(() => void attempt(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, docId, title]);

  return {
    ...state,
    /** Sends anything outstanding now, for a caller about to close. */
    flush: async () => sync.current?.flush(),
    refresh: check,
    active: state.status !== 'inactive',
  };
}
