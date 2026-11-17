import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { undoControllerFor } from '../../collab/stores/undoManager';
import type { ToastType } from '../../common/components/toast/Toast';

export interface UseViewOnlyOptions {
  /** The open document. */
  doc: Y.Doc;
  /** The workspace it is in, when this person may read it but not change
   * it. Null for a local document, and for anyone who may edit. */
  viewOnlyIn: string | null;
  /** Must be stable. */
  showToast: (message: string, type?: ToastType, description?: string) => void;
}

/** A refused edit is announced no more often than this. Dragging a node
 * tries to move it many times a second. */
const ANNOUNCE_EVERY_MS = 6000;

/**
 * Stops edits to a workspace document this person may only view, and says
 * so when they try.
 *
 * The edits are refused by the document's undo controller, which every
 * local edit passes through (see UndoController.setReadOnly), so nothing is
 * written: a viewer's copy stays exactly what the workspace holds.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render and returns nothing, so it adds no component, render or commit.
 */
export function useViewOnly({ doc, viewOnlyIn, showToast }: UseViewOnlyOptions) {
  const lastAnnounced = useRef(0);

  useEffect(() => {
    if (viewOnlyIn === null) return;
    const undo = undoControllerFor(doc);
    undo.setReadOnly(true);
    const stopListening = undo.onRefused(() => {
      const now = Date.now();
      if (now - lastAnnounced.current < ANNOUNCE_EVERY_MS) return;
      lastAnnounced.current = now;
      showToast(
        'This document is view only',
        'info',
        `You can open documents in ${viewOnlyIn} but not change them. An owner of the workspace can make you an editor.`,
      );
    });
    return () => {
      stopListening();
      undo.setReadOnly(false);
    };
  }, [doc, viewOnlyIn, showToast]);
}
