import { useEffect, useMemo, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { unflattenToSubDiagram } from '../../collab/stores/diagramStore';
import { countPersistedReplicas, type PresenceInfo } from '../../collab/sync/session';
import { toDiagramFile } from '../../domain/canvas/serialization';
import {
  clearLegacyAutosave,
  hasLegacyAutosave,
  getAutosaveBlockedReason,
} from '../../domain/storage/autosave';
import { sessionDocumentId } from '../../domain/storage/currentDocument';
import {
  requestPersistentStorage,
  type createDocumentStore,
  type StorageFailureReason,
} from '../../domain/storage/documentStore';
import { installUnloadGuard } from '../../domain/storage/unloadGuard';
import type { DurabilitySignals } from '../../domain/storage/durability';
import type { FileSaving } from '../../hooks/useFileSaving';
import type { useWorkspaceSync } from '../../collab/hooks/useWorkspaceSync';
import { isPerfAutosaveSuppressed } from '../../perf/instrumentation';
import type { ArchNodeData, ArchEdgeData, Scenario } from '../../domain/canvas/types';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import type { Milestone } from '../../domain/timeline/milestones';
import type { SrdDocumentState } from '../../domain/srd/srdTypes';

export interface UseDocumentPersistenceOptions {
  fileSaving: FileSaving;
  workspaceSync: ReturnType<typeof useWorkspaceSync>;
  documentStore: ReturnType<typeof createDocumentStore>;
  activeSession: {
    session: object;
    roomName: string;
    password?: string;
    ownsDocument: boolean;
  } | null;
  openDocId: string;
  title: string;
  scenarios: Scenario[];
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  requirementsSnapshot: RequirementsDocument;
  programIncrementsSnapshot: ProgramIncrement[];
  teamSnapshot: TeamDocument;
  milestonesSnapshot: Milestone[];
  srdSnapshot: SrdDocumentState;
  sessionPersistence: { session: object | null; state: 'active' | 'loading' | 'unavailable' };
  presencePeers: PresenceInfo[];
}

/**
 * Autosave, what the app can confirm about whether the document is safe
 * (durability), the unload guard, and the resumable session. Moved unchanged
 * from App.tsx.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useDocumentPersistence({
  fileSaving,
  workspaceSync,
  documentStore,
  activeSession,
  openDocId,
  title,
  scenarios,
  diagramSnapshot,
  requirementsSnapshot,
  programIncrementsSnapshot,
  teamSnapshot,
  milestonesSnapshot,
  srdSnapshot,
  sessionPersistence,
  presencePeers,
}: UseDocumentPersistenceOptions) {
  // Auto-saves the current diagram to localStorage so a refresh, an
  // accidental tab close, or a crash doesn't lose work - separate from
  // (and in addition to) the explicit Save button, which downloads a real
  // .json file. Debounced the same way undo history is, so a burst of
  // rapid edits (a drag, a typing session) results in one write once
  // things settle rather than one write per change. Once the first
  // autosave has happened, the indicator stays showing "Autosaved" for
  // the rest of the session - there's no real value in a live-ticking
  // "saved 3s ago" here, just confidence that it's happening at all.
  const [hasAutosaved, setHasAutosaved] = useState(false);
  const [autosaveFailure, setAutosaveFailure] = useState<{
    reason: StorageFailureReason;
    message: string;
  } | null>(null);
  const [autosaveBlocked] = useState(getAutosaveBlockedReason);
  const legacyDraftPending = useRef(hasLegacyAutosave());
  const writeToFile = fileSaving.write;
  const flushWorkspace = workspaceSync.flush;
  // Bumped when an attached file becomes writable, so it is written straight
  // away rather than on the next edit.
  const fileWriteEpoch = fileSaving.writeEpoch;

  /**
   * The stored-document id for what is on screen: the open document, or - in
   * a joined session - that session's own replica entry, so joining never
   * overwrites the local document's snapshot (WS1-R5).
   */
  const activeDocId =
    activeSession && activeSession.ownsDocument
      ? sessionDocumentId(activeSession.roomName)
      : openDocId;
  const activeRoom = activeSession?.roomName ?? null;
  const activeKey = activeSession?.password ?? null;

  useEffect(() => {
    // The perf harness measures editing, not autosave - see
    // isPerfAutosaveSuppressed. Always false outside instrumented builds.
    if (isPerfAutosaveSuppressed()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      // Export boundary: built once per debounced write, not once per change.
      const tree = unflattenToSubDiagram(diagramSnapshot.nodes, diagramSnapshot.edges);
      const file = toDiagramFile(
        title,
        tree.nodes,
        tree.edges,
        scenarios,
        requirementsSnapshot,
        programIncrementsSnapshot,
        teamSnapshot,
        milestonesSnapshot,
        srdSnapshot,
      );
      // A snapshot in the document store, alongside the live y-indexeddb
      // replica: it keeps the index's title and time current (WS2-R3), is a
      // readable fallback if the replica is damaged, and is the write whose
      // failure the durability indicator reports (WS2-R4). It replaces the
      // localStorage draft (WS2-R1).
      const origin =
        activeRoom !== null
          ? ({
              origin: 'session',
              sessionRoom: activeRoom,
              sessionKey: activeKey ?? undefined,
            } as const)
          : ({ origin: 'local' } as const);
      // WS13-R1: the attached file belongs to the open local document, never
      // to a joined session's content.
      // The workspace receives the document's own CRDT updates as they
      // happen (useWorkspaceSync), not a snapshot from here. Autosave
      // only pushes it along, so a pause in typing lands in the workspace
      // at the same moment it lands in the browser.
      if (activeDocId === openDocId) {
        void writeToFile(JSON.stringify(file, null, 2));
        void flushWorkspace();
      }
      void documentStore.writeDocument(activeDocId, file, origin).then((result) => {
        if (cancelled) return;
        // Set from the confirmed outcome, never the attempt (NFR-10).
        if (result.ok) {
          setHasAutosaved(true);
          setAutosaveFailure(null);
          // WS2-R5: ask for durable storage when a document is first stored.
          if (result.value.createdAt === result.value.updatedAt) void requestPersistentStorage();
          if (legacyDraftPending.current && activeDocId === openDocId) {
            legacyDraftPending.current = false;
            clearLegacyAutosave();
          }
        } else {
          setAutosaveFailure({ reason: result.reason, message: result.message });
        }
      });
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    title,
    diagramSnapshot,
    scenarios,
    requirementsSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    milestonesSnapshot,
    srdSnapshot,
    documentStore,
    activeDocId,
    activeRoom,
    activeKey,
    openDocId,
    writeToFile,
    fileWriteEpoch,
    flushWorkspace,
  ]);

  /**
   * WS13-R12: the session this document was last shared in, if its room and
   * key were kept - offered as "Resume session" so a former participant can
   * host it again after everyone has left.
   */
  const [resumableSession, setResumableSession] = useState<{ room: string; key: string } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    void documentStore.listDocuments().then((listed) => {
      if (cancelled || !listed.ok) return;
      const entry = listed.value.find((e) => e.docId === openDocId);
      setResumableSession(
        entry?.sessionRoom && entry.sessionKey
          ? { room: entry.sessionRoom, key: entry.sessionKey }
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
    // Re-read when a session ends, which is when a room first becomes resumable.
  }, [documentStore, openDocId, activeRoom]);

  /**
   * What the app currently knows about whether this document is safe
   * (WS13-R8/R9). Every field is a CONFIRMED observation, never an intention:
   * the indicator is the one thing in the UI that must not be optimistic.
   */
  const durabilitySignals: DurabilitySignals = useMemo(() => {
    const inSession = activeSession !== null;
    // The file belongs to the local document. A joined session is another
    // document, and describing it as saved to that file would be false.
    const file = activeSession?.ownsDocument
      ? { fileAccess: fileSaving.signals.fileAccess, fileAttachment: null, fileBacked: false }
      : fileSaving.signals;
    // The workspace, when this document is in one (WS8-R2). A local
    // document, or a browser that is not enrolled, reports nothing here,
    // and the file and browser levels stand as before.
    const serverSync =
      workspaceSync.status === 'saved'
        ? ('synced' as const)
        : workspaceSync.status === 'saving'
          ? ('pending' as const)
          : workspaceSync.status === 'offline'
            ? ('offline' as const)
            : undefined;
    return {
      ...(serverSync ? { serverSync } : {}),
      ...file,
      localPersistence: inSession
        ? sessionPersistence.session === activeSession.session
          ? sessionPersistence.state
          : 'loading'
        : autosaveFailure?.reason === 'unavailable'
          ? 'unavailable'
          : hasAutosaved
            ? 'active'
            : 'loading',
      storageFailure: autosaveFailure,
      autosaveBlockedReason: autosaveBlocked,
      // Counted only in a session; outside one there is nobody else to count,
      // and claiming "you are the only person with a copy" to a solo user
      // would be noise rather than a warning.
      replicaCount: inSession
        ? countPersistedReplicas(
            presencePeers,
            sessionPersistence.session === activeSession.session &&
              sessionPersistence.state === 'active',
          )
        : undefined,
    };
  }, [
    activeSession,
    sessionPersistence,
    autosaveFailure,
    autosaveBlocked,
    hasAutosaved,
    presencePeers,
    fileSaving.signals,
    workspaceSync.status,
  ]);

  // WS13-R7. Read live rather than captured, so the prompt reflects the state
  // at the moment of closing.
  const durabilityRef = useRef(durabilitySignals);
  useEffect(() => {
    durabilityRef.current = durabilitySignals;
  }, [durabilitySignals]);
  useEffect(() => {
    const guard = installUnloadGuard(() => durabilityRef.current);
    return () => guard.release();
  }, []);

  return { hasAutosaved, durabilitySignals, resumableSession, activeDocId };
}
