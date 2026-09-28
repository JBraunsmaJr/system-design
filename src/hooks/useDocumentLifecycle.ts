import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  loadAutosave,
} from '../domain/storage/autosave';
import {
  resolveDocumentId,
  readDocumentParam,
  withDocumentParam,
  LAST_DOCUMENT_KEY,
} from '../domain/storage/currentDocument';
import {
  createDocumentStore,
} from '../domain/storage/documentStore';
import { createDocumentLibrary } from '../collab/sync/documentLibrary';
import { reconciliationWindowMs } from '../domain/network/reconciliationWindow';
import { createIndexedDbBackend } from '../domain/storage/indexedDbBackend';
import { getStoreUrl } from '../domain/storage/storeConfig';
import { useFileSaving } from './useFileSaving';
import {
  acquireDocument,
  type OpenDocument,
} from '../collab/sync/localDocument';
import { releaseUndoController } from '../collab/stores/undoManager';
import type { DiagramFile } from '../domain/canvas/serialization';

export interface UseDocumentLifecycleResult {
  bootFile: DiagramFile | null;
  openDocId: string;
  documentStore: ReturnType<typeof createDocumentStore>;
  documentLibrary: ReturnType<typeof createDocumentLibrary>;
  fileSaving: ReturnType<typeof useFileSaving>;
  storeUrl: string | null;
  openDocumentInTab: (docId: string) => void;
  openDoc: OpenDocument;
}

export function useDocumentLifecycle(): UseDocumentLifecycleResult {
  const [bootFile] = useState<DiagramFile | null>(() => {
    return loadAutosave();
  });

  const [openDocId] = useState(() => {
    let lastDocId: string | null = null;
    try {
      lastDocId = localStorage.getItem(LAST_DOCUMENT_KEY);
    } catch {
      // Storage unavailable: fall through to default.
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
      // Preference only.
    }
  }, [openDocId]);

  const [documentStore] = useState(() => createDocumentStore(createIndexedDbBackend()));
  const [documentLibrary] = useState(() =>
    createDocumentLibrary(
      { store: documentStore },
      { reconciliationWindowMs: reconciliationWindowMs() },
    ),
  );

  const fileSaving = useFileSaving(openDocId);
  const [storeUrl] = useState(() => getStoreUrl());

  const openDocumentInTab = useCallback((docId: string) => {
    const url = new URL(withDocumentParam(window.location.href, docId));
    url.hash = '';
    window.location.assign(url.toString());
  }, []);

  const [openDoc] = useState(() => {
    return acquireDocument({
      docId: openDocId,
      initial: bootFile ?? undefined,
    });
  });

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
        releaseUndoController(held.doc);
        void held.close();
      }, 0);
    };
  }, [openDoc]);

  return {
    bootFile,
    openDocId,
    documentStore,
    documentLibrary,
    fileSaving,
    storeUrl,
    openDocumentInTab,
    openDoc,
  };
}
