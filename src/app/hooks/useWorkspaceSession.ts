import { useCallback, useEffect, useState, type RefObject } from 'react';
import * as Y from 'yjs';
import { useWorkspaceSync } from '../../collab/hooks/useWorkspaceSync';
import { saveDocumentToWorkspace } from '../../collab/sync/workspacePersistence';
import { createStoreClient } from '../../collab/access/storeClient';
import type { OpenDocument } from '../../collab/sync/localDocument';
import type { ToastType } from '../../common/components/toast/Toast';

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
 * it, and joining its room when it is opened. Moved unchanged from App.tsx.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoised with the same
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

  /**
   * Opening a workspace document joins its room. Everyone holding the
   * key computes the same one, so no link changes hands, and the session
   * is what makes an edit legible: who is here, where their cursor is,
   * what they just changed (WS3).
   *
   * The document is saved to the workspace throughout, by its own sync -
   * the session is how people see each other, not how work is kept.
   */
  useEffect(() => {
    const room = workspaceSync.session?.room ?? null;
    const key = workspaceSync.session?.key ?? null;
    if (!room || !key) return;
    // A deployment with no relay has no live sessions at all. The
    // document still saves to the workspace; people just do not see each
    // other, which is the behaviour before any of this existed.
    if (signalingUrls.length === 0) return;
    // Someone in a session they chose - started, or joined by link - is
    // left in it.
    if (activeSessionRef.current || autoJoinedRoomRef.current === room) return;
    autoJoinedRoomRef.current = room;
    void startNewSession(key, room, { autoJoined: true });
  }, [
    workspaceSync.session?.room,
    workspaceSync.session?.key,
    signalingUrls,
    startNewSession,
    activeSessionRef,
    autoJoinedRoomRef,
  ]);

  // Leaving the document, or taking it out of the workspace, ends the
  // session it joined on its behalf.
  useEffect(() => {
    return () => {
      autoJoinedRoomRef.current = null;
    };
  }, [openDocId, autoJoinedRoomRef]);

  return { workspaceSync, handleSaveToWorkspace, isSavingToWorkspace };
}
