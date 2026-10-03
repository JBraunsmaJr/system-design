import {useCallback, useMemo, useSyncExternalStore} from 'react';
import type * as Y from 'yjs';
import {undoableStore, undoControllerFor} from '../../collab/stores/undoManager';
import type {OpenDocument, OpenDocumentStores} from '../../collab/sync/localDocument';
import type {Scenario} from '../../domain/canvas/types';

export interface UseDocumentStoresOptions {
  /** The joined session's document and stores, when in one. */
  activeSession: { doc: Y.Doc; stores: OpenDocumentStores } | null;
  openDoc: OpenDocument;
}

/**
 * The stores for the document on screen, wrapped for undo, and their
 * snapshots. Moved unchanged from App.tsx.
 *
 * PERFORMANCE: the useSyncExternalStore subscriptions here are what make
 * App re-render on a document change. Keep them in App's render (a hook is
 * fine); moving one into a child component would stop App re-rendering for
 * that domain, and anything App passes down that reads it would go stale.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useDocumentStores({ activeSession, openDoc }: UseDocumentStoresOptions) {
  /**
   * The active store set (WS1-R1).
   *
   * One document, so this is no longer a choice between two representations -
   * a session's stores and the open document's stores are both Yjs stores over
   * the same schema. The adapter fallback covers only the few frames before
   * the document finishes opening; deleting it is Step 4.
   */
  /**
   * The document the user is looking at: the joined session's while in one,
   * otherwise the open local document (which is also the shared one after
   * starting a session). Whole-document writes - load, New - target this, so
   * they change what is on screen rather than a document nobody can see.
   */
  const activeDoc = activeSession?.doc ?? openDoc.doc;
  const rawStores = activeSession?.stores ?? openDoc.stores;

  /**
   * Undo for the document on screen (WS3-R1, WS3-R2). Scoped by origin, so it
   * works identically in and out of a session and never reverts a peer's edit.
   */
  const undo = useMemo(() => undoControllerFor(activeDoc), [activeDoc]);
  const canUndo = useSyncExternalStore(undo.subscribe, undo.canUndo);
  const canRedo = useSyncExternalStore(undo.subscribe, undo.canRedo);

  /**
   * The seams everything reads and writes through. Every mutating method runs
   * under the undo origin (undoableStore), so no call site can make an edit
   * that silently falls outside history. Memoized on the underlying store set,
   * so identities are stable for useSyncExternalStore and memoized children.
   */
  const teamStore = useMemo(() => undoableStore(rawStores.team, undo), [rawStores, undo]);
  const requirementsStore = useMemo(
    () => undoableStore(rawStores.requirements, undo),
    [rawStores, undo],
  );
  const programIncrementsStore = useMemo(
    () => undoableStore(rawStores.programIncrements, undo),
    [rawStores, undo],
  );
  const milestonesStore = useMemo(
    () => undoableStore(rawStores.milestones, undo),
    [rawStores, undo],
  );
  const diagramStore = useMemo(() => undoableStore(rawStores.diagram, undo), [rawStores, undo]);
  const metaStore = useMemo(() => undoableStore(rawStores.meta, undo), [rawStores, undo]);
  const metaSnapshot = useSyncExternalStore(metaStore.subscribe, metaStore.getSnapshot);
  // Subscribed here like every other domain, so autosave and file saves see
  // SRD edits. Edits are infrequent and the snapshot keeps unchanged parts'
  // identity, so this costs App a render only when the SRD actually changes.
  const srdStore = useMemo(() => undoableStore(rawStores.srd, undo), [rawStores, undo]);
  const srdSnapshot = useSyncExternalStore(srdStore.subscribe, srdStore.getSnapshot);
  const { title, scenarios } = metaSnapshot;

  // Same value-or-updater shape as the useState setters these replaced, so
  // every existing call site is unchanged.
  const setTitle = useCallback(
    (updater: string | ((prev: string) => string)) =>
      metaStore.setTitle(
        typeof updater === 'function' ? updater(metaStore.getSnapshot().title) : updater,
      ),
    [metaStore],
  );
  const setScenarios = useCallback(
    (updater: Scenario[] | ((prev: Scenario[]) => Scenario[])) =>
      metaStore.setScenarios(
        typeof updater === 'function' ? updater(metaStore.getSnapshot().scenarios) : updater,
      ),
    [metaStore],
  );

  // Subscribed via useSyncExternalStore (not just a plain useMemo keyed
  // on diagramStore/path/selection) because the Yjs-backed session store
  // never changes ITS OWN object reference when a remote peer edits the
  // diagram - it's the same store instance for the whole session. A
  // plain useMemo would never re-run for a remote change at all, only
  // ever catching up once something else (like switching views) forced
  // a re-render for an unrelated reason. The local adapter's own
  // subscribe is a deliberate no-op (local mode already re-renders via
  // React's own state flow when setRoot changes), so this costs nothing
  // extra there - it's specifically the collaborative path this fixes.
  const diagramSnapshot = useSyncExternalStore(diagramStore.subscribe, diagramStore.getSnapshot);
  const teamSnapshot = useSyncExternalStore(teamStore.subscribe, teamStore.getSnapshot);
  const requirementsSnapshot = useSyncExternalStore(
    requirementsStore.subscribe,
    requirementsStore.getSnapshot,
  );
  const programIncrementsSnapshot = useSyncExternalStore(
    programIncrementsStore.subscribe,
    programIncrementsStore.getSnapshot,
  );
  const milestonesSnapshot = useSyncExternalStore(
    milestonesStore.subscribe,
    milestonesStore.getSnapshot,
  );

  // No tree is derived here (WS1-R3). The flat snapshot is canonical; the
  // recursive tree is built only at export boundaries (save, autosave) and for
  // the views that are written against it - see diagramTree further down.
  // Deriving it unconditionally cost a full unflatten per document change,
  // which the perf gate recorded as one per remote update.

  return {
    activeDoc,
    undo,
    canUndo,
    canRedo,
    teamStore,
    requirementsStore,
    programIncrementsStore,
    milestonesStore,
    diagramStore,
    srdStore,
    srdSnapshot,
    title,
    scenarios,
    setTitle,
    setScenarios,
    diagramSnapshot,
    teamSnapshot,
    requirementsSnapshot,
    programIncrementsSnapshot,
    milestonesSnapshot,
  };
}
