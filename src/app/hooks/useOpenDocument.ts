import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveDocumentId,
  readDocumentParam,
  withDocumentParam,
  LAST_DOCUMENT_KEY,
} from '../../domain/storage/currentDocument';
import { createDocumentStore } from '../../domain/storage/documentStore';
import { createIndexedDbBackend } from '../../domain/storage/indexedDbBackend';
import { createDocumentLibrary } from '../../collab/sync/documentLibrary';
import { reconciliationWindowMs } from '../../domain/network/reconciliationWindow';
import { loadAutosave } from '../../domain/storage/autosave';
import { acquireDocument } from '../../collab/sync/localDocument';
import { releaseUndoController } from '../../collab/stores/undoManager';
import {
  diagramFileToSnapshot,
  snapshotToDiagramFile,
  DEFAULT_SNAPSHOT,
  type DiagramSnapshot,
} from '../documentSnapshot';

/**
 * Which document this tab has open, the open document itself, and the
 * catalogue of stored documents (WS1-R1, WS2-R3). Moved unchanged from
 * App.tsx.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useOpenDocument() {
  /**
   * What the app booted with: a restored autosave, or the default. Read once,
   * to seed the open document when it turns out to be empty; the document is
   * the model from then on (WS1-R1), including for title and scenarios.
   */
  const [bootSnapshot] = useState<DiagramSnapshot>(() => {
    // The retired localStorage draft, read once (WS2-R1). It only seeds the
    // document if the document turns out to be empty, and is cleared after
    // the first successful save to the document store.
    const autosave = loadAutosave();
    return autosave ? diagramFileToSnapshot(autosave) : DEFAULT_SNAPSHOT;
  });

  /**
   * Which document this tab has open (WS2-R3): the URL's `?doc=`, else the
   * last one opened in this browser, else "local". Written back to the URL so
   * a reload reopens it and another tab can hold a different one.
   */
  const [openDocId] = useState(() => {
    let lastDocId: string | null = null;
    try {
      lastDocId = localStorage.getItem(LAST_DOCUMENT_KEY);
    } catch {
      // Storage unavailable: fall through to the default document.
    }
    return resolveDocumentId({ urlDocId: readDocumentParam(window.location.href), lastDocId })
      .docId;
  });
  useEffect(() => {
    const next = withDocumentParam(window.location.href, openDocId);
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next);
    try {
      localStorage.setItem(LAST_DOCUMENT_KEY, openDocId);
    } catch {
      // A preference; losing it only means a bare URL opens the default.
    }
  }, [openDocId]);

  /** The catalogue of stored documents and their snapshots (WS2-R3). */
  const [documentStore] = useState(() => createDocumentStore(createIndexedDbBackend()));
  const [documentLibrary] = useState(() =>
    createDocumentLibrary(
      { store: documentStore },
      { reconciliationWindowMs: reconciliationWindowMs() },
    ),
  );

  /**
   * Switches this tab to another stored document by navigating, so the open
   * document is closed and released exactly as on any unload. Any session
   * link is dropped - opening a document must not rejoin a session.
   */
  const openDocumentInTab = useCallback((docId: string) => {
    const url = new URL(withDocumentParam(window.location.href, docId));
    url.hash = '';
    window.location.assign(url.toString());
  }, []);

  /**
   * The open document (WS1-R1). Created by a lazy initializer so it exists from the
   * first render - which is what lets the seams below drop their adapter
   * fallback entirely (WS1 Step 4). The initializer runs exactly once, so
   * `diagram` is read at boot and never again.
   */
  const [openDoc] = useState(() => {
    // The restored autosave is a DiagramFile, so its root is the nested tree,
    // and openDocumentNow's seed is the import boundary that flattens it
    // (WS1-R3). Passing it through unchanged is the point: flattening here as
    // well is how the two load paths came to disagree about the shape.
    // acquireDocument, not openDocumentNow: StrictMode runs this initializer
    // twice, and a second live provider on the same database corrupts it.
    return acquireDocument({
      docId: openDocId,
      initial: snapshotToDiagramFile(bootSnapshot),
    });
  });
  // The document exists from the first render; this only has to release it.
  //
  // The close is deferred by a task, and cancelled if the effect runs again
  // first. StrictMode (dev only) runs this cleanup and the effect back to back
  // at mount while keeping the same state - so an immediate close destroyed
  // the stores of a document the app went on using, and no local edit ever
  // reached the canvas in dev. A real unmount still closes, one task later.
  const pendingClose = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const held = openDoc;
    if (pendingClose.current !== null) {
      clearTimeout(pendingClose.current);
      pendingClose.current = null;
    }
    return () => {
      pendingClose.current = setTimeout(() => {
        pendingClose.current = null;
        // Step 1 exists for this: without it every remount leaves observers
        // rebuilding snapshots against a document nobody reads.
        releaseUndoController(held.doc);
        void held.close();
      }, 0);
    };
  }, [openDoc]);

  return { openDocId, openDoc, documentStore, documentLibrary, openDocumentInTab };
}
