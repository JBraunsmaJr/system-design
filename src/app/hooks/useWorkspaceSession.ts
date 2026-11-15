import { useCallback, useState, type RefObject } from 'react';
import * as Y from 'yjs';
import { useWorkspaceSync } from '../../collab/hooks/useWorkspaceSync';
import { saveDocumentToWorkspace } from '../../collab/sync/workspacePersistence';
import { createStoreClient } from '../../collab/access/storeClient';
import type { OpenDocument } from '../../collab/sync/localDocument';
import type { ToastType } from '../../common/components/toast/Toast';
import { useDocumentSessionJoin } from './useDocumentSessionJoin';

export interface UseWorkspaceSessionOptions {
  storeUrl: string | null;
  openDocId: string;
  openDoc: OpenDocument;
  title: string;
  showToast: (message: string, type?: ToastType, description?: string) => void;
  signalingUrls: string[];
  activeSessionRef: RefObject<unknown>;
  autoJoinedRoomRef: RefObject<string | null>;
  startNewSession: (
    explicitKey?: string,
    explicitRoom?: string,
    options?: { autoJoined?: boolean },
  ) => Promise<void>;
}

/**
 * Keeping a workspace document in step with the store (WS8-R2), saving to
 * it, and joining its room when it is opened (useDocumentSessionJoin).
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useWorkspaceSession({
  storeUrl,
  openDocId,
  openDoc,
  title,
  showToast,
  signalingUrls,
  activeSessionRef,
  autoJoinedRoomRef,
  startNewSession,
}: UseWorkspaceSessionOptions) {
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);

  /**
   * A workspace document keeps itself up to date (WS8-R2): its CRDT
   * updates go to the store as they happen, and other people's arrive the
   * same way, so two editors merge rather than overwrite. Inactive for a
   * local document, or a browser that has not been enrolled.
   */
  const workspaceSync = useWorkspaceSync({ storeUrl, docId: openDocId, doc: openDoc.doc, title });

  const handleSaveToWorkspace = useCallback(async () => {
    if (!storeUrl) return;
    setIsSavingToWorkspace(true);
    try {
      const client = createStoreClient({ baseUrl: storeUrl });
      const docState = Y.encodeStateAsUpdate(openDoc.doc);
      await saveDocumentToWorkspace({
        client,
        docId: openDocId,
        title,
        documentState: docState,
      });
      showToast('Saved to workspace');
    } catch (error) {
      console.error('Failed to save to workspace:', error);
      showToast('Could not save to workspace', 'error');
    } finally {
      setIsSavingToWorkspace(false);
    }
  }, [storeUrl, openDoc.doc, openDocId, title, showToast]);

  useDocumentSessionJoin({
    session: workspaceSync.session,
    openDocId,
    signalingUrls,
    activeSessionRef,
    autoJoinedRoomRef,
    startNewSession,
  });

  return { workspaceSync, handleSaveToWorkspace, isSavingToWorkspace };
}
