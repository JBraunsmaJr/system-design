import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react';
import * as Y from 'yjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';
import { Toolbar } from './components/canvas/Toolbar';
import { CollabPanel } from './components/workspace/CollabPanel';
import { Palette } from './components/canvas/Palette';
import { Canvas } from './components/canvas/Canvas';
import { Inspector } from './components/canvas/Inspector';
import { ScenarioPanel } from './components/canvas/ScenarioPanel';
import { LibraryManagerModal } from './components/workspace/LibraryManagerModal';
import { RequirementsView } from './components/requirements/RequirementsView';
import { TimelineView } from './components/timeline/TimelineView';
import { TeamView } from './components/team/TeamView';
import { SkillTreeView } from './components/skilltree/SkillTreeView';
import type { DiagramPath } from './domain/canvas/subDiagramTree';
import {
  toDiagramFile,
  downloadDiagram,
  downloadDiagramAs,
  parseDiagramFile,
} from './domain/canvas/serialization';
import { sanitizeFileName } from './common/utils/string';
import {
  loadTimedCopies,
  saveTimedCopies,
  timedCopyFileName,
  isCopyDue,
  TIMED_COPIES_TEST_SECONDS_KEY,
  type TimedCopiesSettings,
} from './domain/storage/timedCopies';
import { clearLegacyAutosave, getAutosaveBlockedReason } from './domain/storage/autosave';
import { DocumentManager } from './components/workspace/DocumentManager';
import { WorkspacePanel } from './components/workspace/WorkspacePanel';
import { DurabilityIndicator } from './components/workspace/DurabilityIndicator';
import { installUnloadGuard } from './domain/storage/unloadGuard';
import type { DurabilitySignals } from './domain/storage/durability';
import { countPersistedReplicas, startCollabSession } from './collab/sync/session';
import { isSoleReplicaHolder } from './domain/storage/durability';
import { LeaveGuardDialog } from './components/workspace/LeaveGuardDialog';
import { useWorkspaceSync } from './collab/hooks/useWorkspaceSync';
import { createStoreClient } from './collab/access/storeClient';
import { saveDocumentToWorkspace } from './collab/sync/workspacePersistence';
import { unflattenToSubDiagram } from './collab/stores/diagramStore';
import { AccessRequestNotice } from './components/workspace/AccessRequestNotice';
import { getDefaultSignalingUrl } from './domain/network/signalingConfig';
import { getDefaultIceServers, parseIceServers } from './domain/network/iceServerConfig';
import { replaceDocumentContents, createDocumentStores } from './collab/sync/localDocument';
import { undoControllerFor } from './collab/stores/undoManager';
import { SrdPrintModal } from './components/srd/SrdPrintModal';
import { Toast } from './common/components/toast/Toast';
import { getStandardFixture, type FixtureName } from './perf/fixtures';
import type { SubDiagram } from './domain/canvas/types';
import { useDocumentLifecycle } from './hooks/useDocumentLifecycle';
import { useCollabState } from './hooks/useCollabState';
import { useDiagramCanvasOps } from './hooks/useDiagramCanvasOps';
import { useScenarioRunner } from './hooks/useScenarioRunner';
import { useAppModals } from './hooks/useAppModals';
import { useAppExport } from './hooks/useAppExport';

export function App() {
  const [viewMode, setViewMode] = useState<
    'diagram' | 'requirements' | 'timeline' | 'team' | 'skill-tree'
  >('diagram');
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isScenarioPanelCollapsed, setIsScenarioPanelCollapsed] = useState(true);
  const [focusRequirementId, setFocusRequirementId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  const {
    openDocId,
    documentStore,
    documentLibrary,
    fileSaving,
    storeUrl,
    openDocumentInTab,
    openDoc,
  } = useDocumentLifecycle();

  const {
    isDocumentManagerOpen,
    setIsDocumentManagerOpen,
    isLibraryOpen,
    setIsLibraryOpen,
    isLeaveGuardOpen,
    setIsLeaveGuardOpen,
    toast,
    setToast,
    showToast,
  } = useAppModals();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const collab = useCollabState({
    storeUrl,
    openDocId,
    openDocStores: openDoc.stores,
    openDocInstance: openDoc,
    onSessionEnded: () => {
      // Reconnected back to local doc
    },
  });

  const activeDoc = collab.activeSession?.doc ?? openDoc.doc;
  const activeStores = collab.activeSession?.stores ?? openDoc.stores;

  const diagramStore = activeStores.diagram;
  const requirementsStore = activeStores.requirements;
  const milestonesStore = activeStores.milestones;
  const programIncrementsStore = activeStores.programIncrements;
  const teamStore = activeStores.team;
  const metaStore = activeStores.meta;

  const undo = useMemo(() => undoControllerFor(activeDoc), [activeDoc]);

  const diagramSnapshot = useSyncExternalStore(
    diagramStore.subscribe,
    diagramStore.getSnapshot,
    diagramStore.getSnapshot,
  );
  const requirementsSnapshot = useSyncExternalStore(
    requirementsStore.subscribe,
    requirementsStore.getSnapshot,
    requirementsStore.getSnapshot,
  );
  const milestonesSnapshot = useSyncExternalStore(
    milestonesStore.subscribe,
    milestonesStore.getSnapshot,
    milestonesStore.getSnapshot,
  );
  const programIncrementsSnapshot = useSyncExternalStore(
    programIncrementsStore.subscribe,
    programIncrementsStore.getSnapshot,
    programIncrementsStore.getSnapshot,
  );
  const teamSnapshot = useSyncExternalStore(
    teamStore.subscribe,
    teamStore.getSnapshot,
    teamStore.getSnapshot,
  );
  const metaSnapshot = useSyncExternalStore(
    metaStore.subscribe,
    metaStore.getSnapshot,
    metaStore.getSnapshot,
  );

  const title = metaSnapshot.title || 'Architecture Diagram';
  const setTitle = useCallback(
    (newTitle: string) => {
      undo.transact(() => metaStore.setTitle(newTitle));
      const targetDocId = collab.activeSession?.ownsDocument
        ? `session:${collab.activeSession.roomName}`
        : openDocId;
      void documentStore.renameDocument(targetDocId, newTitle);
    },
    [undo, metaStore, documentStore, openDocId, collab.activeSession],
  );

  const scenarios = useMemo(() => metaSnapshot.scenarios ?? [], [metaSnapshot.scenarios]);
  const setScenarios = useCallback(
    (updater: (s: typeof scenarios) => typeof scenarios) => {
      undo.transact(() => metaStore.setScenarios(updater(metaStore.getSnapshot().scenarios ?? [])));
    },
    [undo, metaStore],
  );

  const canUndo = useSyncExternalStore(undo.subscribe, () => undo.canUndo());
  const canRedo = useSyncExternalStore(undo.subscribe, () => undo.canRedo());

  const canvasOps = useDiagramCanvasOps({
    diagramStore,
    diagramSnapshot,
    undo,
    activeSession: collab.activeSession,
    presencePeers: collab.presencePeers,
    broadcastPresence: collab.broadcastPresence,
    viewMode,
  });

  const scenarioRunner = useScenarioRunner({
    scenarios,
    setScenarios,
    selectedNodeIds: canvasOps.selectedNodeIds,
    selectedEdgeIds: canvasOps.selectedEdgeIds,
    setSelectedNodeIds: canvasOps.setSelectedNodeIds,
    setSelectedEdgeIds: canvasOps.setSelectedEdgeIds,
    path: canvasOps.path,
    setPath: canvasOps.setPath,
  });

  const appExport = useAppExport({
    nodes: canvasOps.nodes,
    title,
    path: canvasOps.path,
    setPath: canvasOps.setPath,
    diagramSnapshot,
    requirementsSnapshot,
    milestonesSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    showToast,
  });

  // Test harness registration
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__PERF__) {
      const perfObj = (window as unknown as Record<string, unknown>).__PERF__ as Record<
        string,
        unknown
      >;
      perfObj.Y = Y;
      (window as unknown as Record<string, unknown>).Y = Y;
      perfObj.loadFixture = (name: FixtureName) => {
        const fixture = getStandardFixture(name);
        diagramStore.replaceAll(fixture);
        return fixture;
      };
      perfObj.setDiagram = (diagram: SubDiagram) => {
        diagramStore.replaceAll(diagram);
      };
      perfObj.addNode = (label: string) =>
        diagramStore.addNode(
          [],
          'typed',
          { x: Math.random() * 400, y: Math.random() * 400 },
          { nodeType: 'service', label, properties: {}, tags: [] },
        );
      perfObj.setPath = (newPath: string[]) => {
        canvasOps.setPath(newPath);
      };
      perfObj.setSelectedNodes = (nodeIds: string[]) => {
        canvasOps.setSelectedNodeIds(nodeIds);
      };
      perfObj.setSelectedEdges = (edgeIds: string[]) => {
        canvasOps.setSelectedEdgeIds(edgeIds);
      };
      perfObj.startCollabSessionWithDoc = (doc: Y.Doc) => {
        const roomName = `perf-room-${Math.random().toString(36).slice(2, 8)}`;
        const stores = createDocumentStores(doc);
        const session = startCollabSession(doc, roomName, {
          signalingUrls: [getDefaultSignalingUrl()],
          iceServers: parseIceServers(getDefaultIceServers()),
          persist: false,
        });
        collab.setActiveSession({
          doc,
          session,
          roomName,
          stores,
          ownsDocument: true,
        });
      };
      perfObj.leaveCollabSession = () => {
        collab.leaveSession();
      };
      perfObj.docBytes = () => Y.encodeStateAsUpdate(activeDoc).byteLength;
    }
  }, [diagramStore, canvasOps, collab, activeDoc]);

  // Timed copies
  const [timedCopies, setTimedCopies] = useState<TimedCopiesSettings>(() => loadTimedCopies());
  useEffect(() => {
    saveTimedCopies(timedCopies);
  }, [timedCopies]);

  const lastCopiedContentRef = useRef<string | null>(null);

  const buildCurrentFile = useCallback(() => {
    const tree = unflattenToSubDiagram(diagramSnapshot.nodes, diagramSnapshot.edges);
    return toDiagramFile(
      title,
      tree.nodes,
      tree.edges,
      scenarios,
      requirementsSnapshot,
      programIncrementsSnapshot,
      teamSnapshot,
      milestonesSnapshot,
    );
  }, [
    title,
    diagramSnapshot,
    scenarios,
    requirementsSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    milestonesSnapshot,
  ]);

  useEffect(() => {
    let cancelled = false;
    const file = buildCurrentFile();
    const isCollab = collab.activeSession !== null;

    if (!isCollab || !collab.activeSession) {
      void openDoc.persistence.whenSynced.then(async () => {
        if (cancelled) return;
        await documentStore.writeDocument(openDocId, file);
        clearLegacyAutosave();
      });
    } else {
      const active = collab.activeSession;
      const options = {
        origin: 'session' as const,
        sessionRoom: active.roomName,
        sessionKey: active.password,
        sessionRelay:
          active.relayUrl || collab.signalingUrlsInput || collab.buildTimeSignalingDefault,
      };
      const targetDocId = active.ownsDocument ? `session:${active.roomName}` : openDocId;
      void documentStore.writeDocument(targetDocId, file, options);
    }

    return () => {
      cancelled = true;
    };
  }, [
    openDocId,
    openDoc,
    buildCurrentFile,
    documentStore,
    collab.activeSession,
    collab.signalingUrlsInput,
    collab.buildTimeSignalingDefault,
  ]);

  useEffect(() => {
    if (!timedCopies.enabled) {
      lastCopiedContentRef.current = null;
      return;
    }
    const getTestSecs = () => {
      try {
        const v =
          sessionStorage.getItem(TIMED_COPIES_TEST_SECONDS_KEY) ??
          localStorage.getItem(TIMED_COPIES_TEST_SECONDS_KEY);
        return v !== null ? Number(v) : null;
      } catch {
        return null;
      }
    };
    const testSecs = getTestSecs();
    const intervalMs =
      testSecs !== null ? testSecs * 1000 : (timedCopies.minutes ?? 15) * 60 * 1000;

    const timer = setInterval(() => {
      const file = buildCurrentFile();
      const rest = { ...file } as Record<string, unknown>;
      delete rest.metadata;
      const content = JSON.stringify(rest);
      if (isCopyDue(content, lastCopiedContentRef.current)) {
        const filename = timedCopyFileName(title, new Date());
        downloadDiagramAs(file, filename);
        lastCopiedContentRef.current = content;
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [timedCopies.enabled, timedCopies.minutes, buildCurrentFile, title]);

  // Workspace synchronization
  const workspaceSync = useWorkspaceSync({
    storeUrl,
    docId: openDocId,
    doc: activeDoc,
    title,
  });

  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);

  const onSaveToWorkspace = useCallback(async () => {
    if (!storeUrl) return;
    setIsSavingToWorkspace(true);
    try {
      const client = createStoreClient({ baseUrl: storeUrl });
      const documentState = Y.encodeStateAsUpdate(activeDoc);
      await saveDocumentToWorkspace({
        client,
        docId: openDocId,
        title,
        documentState,
      });
      showToast('Saved to workspace');
    } catch (err) {
      showToast(
        'Failed to save to workspace',
        'error',
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setIsSavingToWorkspace(false);
    }
  }, [storeUrl, openDocId, title, activeDoc, showToast]);

  const hasAutosaved = true;
  const autosaveBlocked = getAutosaveBlockedReason();

  const durabilitySignals: DurabilitySignals = useMemo(() => {
    const isCollab = collab.activeSession !== null;
    const sessionPersistence = collab.sessionPersistence;
    const localPersistence = isCollab
      ? sessionPersistence.session === collab.activeSession?.session
        ? sessionPersistence.state
        : 'loading'
      : 'active';
    const selfHasReplica = isCollab && localPersistence === 'active';
    const replicaCount = isCollab
      ? countPersistedReplicas(collab.presencePeers ?? [], selfHasReplica)
      : undefined;

    const serverSync =
      workspaceSync.status === 'saved'
        ? 'synced'
        : workspaceSync.status === 'saving'
          ? 'pending'
          : workspaceSync.status === 'offline'
            ? 'offline'
            : undefined;

    return {
      localPersistence,
      replicaCount,
      autosaveBlockedReason: autosaveBlocked,
      fileBacked: fileSaving.signals.fileBacked,
      fileAccess: fileSaving.signals.fileAccess,
      fileAttachment: fileSaving.signals.fileAttachment,
      serverSync,
    };
  }, [
    collab.activeSession,
    collab.presencePeers,
    collab.sessionPersistence,
    autosaveBlocked,
    fileSaving.signals,
    workspaceSync.status,
  ]);

  useEffect(() => {
    if (workspaceSync.session && !collab.activeSession) {
      collab.handleStartSession(workspaceSync.session.key, workspaceSync.session.room);
    }
  }, [workspaceSync.session, collab.activeSession, collab]);

  const durabilityRef = useRef(durabilitySignals);
  useEffect(() => {
    durabilityRef.current = durabilitySignals;
  }, [durabilitySignals]);

  useEffect(() => {
    const guard = installUnloadGuard(() => durabilityRef.current);
    return () => guard.release();
  }, []);

  const requestLeave = useCallback(() => {
    if (isSoleReplicaHolder(durabilitySignals)) setIsLeaveGuardOpen(true);
    else collab.leaveSession();
  }, [durabilitySignals, collab, setIsLeaveGuardOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (scenarioRunner.isPresenting) return;
      if (viewMode !== 'diagram') return;
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (canvasOps.selectedNodeIds.length > 0 || canvasOps.selectedEdgeIds.length > 0) {
        canvasOps.onDeleteSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scenarioRunner.isPresenting, viewMode, canvasOps]);

  const onUndo = useCallback(() => {
    if (scenarioRunner.isPresenting) return;
    undo.undo();
    canvasOps.setSelectedNodeIds([]);
    canvasOps.setSelectedEdgeIds([]);
  }, [scenarioRunner.isPresenting, undo, canvasOps]);

  const onRedo = useCallback(() => {
    if (scenarioRunner.isPresenting) return;
    undo.redo();
    canvasOps.setSelectedNodeIds([]);
    canvasOps.setSelectedEdgeIds([]);
  }, [scenarioRunner.isPresenting, undo, canvasOps]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (scenarioRunner.isPresenting) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'c') {
        const selection = window.getSelection();
        const hasTextSelection = Boolean(
          selection && !selection.isCollapsed && selection.toString().length > 0,
        );
        if (hasTextSelection) return;
        if (viewMode !== 'diagram') return;
        event.preventDefault();
        canvasOps.onCopy();
      } else if ((event.ctrlKey || event.metaKey) && key === 'v') {
        if (viewMode !== 'diagram') return;
        event.preventDefault();
        canvasOps.onPaste();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scenarioRunner.isPresenting, viewMode, canvasOps]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (scenarioRunner.isPresenting) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const key = event.key.toLowerCase();
      const isZ = key === 'z';
      const isY = key === 'y';
      const isCtrlOrMeta = event.ctrlKey || event.metaKey;

      if (isCtrlOrMeta && isZ && !event.shiftKey) {
        event.preventDefault();
        onUndo();
      } else if ((isCtrlOrMeta && isZ && event.shiftKey) || (isCtrlOrMeta && isY)) {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scenarioRunner.isPresenting, onUndo, onRedo]);

  const onSave = useCallback(() => {
    downloadDiagram(buildCurrentFile());
  }, [buildCurrentFile]);

  const onLoadFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const parsed = parseDiagramFile(content);
          replaceDocumentContents(activeDoc, parsed);
          undo.clear();
          showToast(`Loaded ${file.name}`);
        } catch (err) {
          showToast('Failed to load file', 'error', (err as Error).message);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },
    [activeDoc, undo, showToast],
  );

  const handleNavigateToNode = useCallback(
    (targetPath: DiagramPath, targetNodeId: string) => {
      setViewMode('diagram');
      canvasOps.setPath(targetPath);
      canvasOps.setSelectedNodeIds([targetNodeId]);
      canvasOps.setSelectedEdgeIds([]);
      setFocusNodeId(targetNodeId);
    },
    [canvasOps],
  );

  const handleNavigateToRequirement = useCallback((itemId: string) => {
    setViewMode('requirements');
    setFocusRequirementId(itemId);
  }, []);

  const handleCreateLinkedNode = useCallback(
    (itemId: string, itemTitle: string) => {
      const id = diagramStore.addNode(
        canvasOps.path,
        'typed',
        { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
        {
          nodeType: 'service',
          label: itemTitle || itemId,
          description: '',
          properties: {},
          tags: [],
          linkedRequirementIds: [itemId],
        },
      );
      handleNavigateToNode(canvasOps.path, id);
    },
    [diagramStore, canvasOps.path, handleNavigateToNode],
  );

  const onNew = useCallback(() => {
    const newId = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    openDocumentInTab(newId);
  }, [openDocumentInTab]);

  useEffect(() => {
    if (collab.activeSession?.autoJoined) {
      showToast(`Joined session ${collab.activeSession.roomName}`);
    }
  }, [collab.activeSession, showToast]);

  useEffect(() => {
    if (fileSaving.signals.fileBacked) {
      void fileSaving.write(JSON.stringify(buildCurrentFile(), null, 2));
    }
  }, [
    diagramSnapshot,
    requirementsSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    milestonesSnapshot,
    title,
    buildCurrentFile,
    fileSaving.signals.fileBacked,
    fileSaving,
  ]);

  const prevWriteEpochRef = useRef(fileSaving.writeEpoch);
  useEffect(() => {
    if (fileSaving.writeEpoch > 0 && fileSaving.writeEpoch !== prevWriteEpochRef.current) {
      prevWriteEpochRef.current = fileSaving.writeEpoch;
      void fileSaving.write(JSON.stringify(buildCurrentFile(), null, 2));
    }
  }, [fileSaving.writeEpoch, buildCurrentFile, fileSaving]);

  const [resumableSession, setResumableSession] = useState<{
    room: string;
    key?: string;
    relay?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    documentStore.listDocuments().then((res) => {
      if (cancelled || !res.ok) return;
      const entries = res.value;
      const entry = entries.find((e) => e.docId === openDocId);
      if (entry?.origin === 'session' && entry.sessionRoom) {
        setResumableSession({
          room: entry.sessionRoom,
          key: entry.sessionKey,
          relay: entry.sessionRelay,
        });
      } else if (openDocId.startsWith('session:')) {
        const room = openDocId.slice('session:'.length);
        setResumableSession({
          room,
          key: entry?.sessionKey,
          relay: entry?.sessionRelay,
        });
      } else {
        setResumableSession(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [openDocId, documentStore, collab.activeSession]);

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar
          title={title}
          onTitleChange={setTitle}
          onNew={onNew}
          onOpenDocuments={() => setIsDocumentManagerOpen(true)}
          onSave={onSave}
          onLoadClick={() => fileInputRef.current?.click()}
          isScenarioPanelOpen={!isScenarioPanelCollapsed}
          onToggleScenarioPanel={() => setIsScenarioPanelCollapsed((c) => !c)}
          onExportPng={appExport.onExportPng}
          onExportSvg={appExport.onExportSvg}
          onExportSrdMarkdown={appExport.onExportSrdMarkdown}
          onExportSrdPrint={appExport.openSrdModal}
          canExport={canvasOps.nodes.length > 0}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          onExportRequirementsMarkdown={appExport.onExportRequirementsMarkdown}
          canExportRequirements={requirementsSnapshot.items.length > 0}
          onManageLibraries={() => setIsLibraryOpen(true)}
          hasAutosaved={hasAutosaved}
          isInSession={collab.activeSession !== null && !workspaceSync.session}
          durabilityIndicator={
            <DurabilityIndicator
              signals={durabilitySignals}
              onExport={onSave}
              onChooseFile={() => {
                const file = buildCurrentFile();
                void fileSaving
                  .attach(`${sanitizeFileName(title || openDocId)}.json`)
                  .then(() => fileSaving.write(JSON.stringify(file, null, 2)));
              }}
              onRetry={() => fileSaving.write(JSON.stringify(buildCurrentFile(), null, 2))}
              onResumeFile={() => {
                const file = buildCurrentFile();
                void fileSaving
                  .resume()
                  .then(() => fileSaving.write(JSON.stringify(file, null, 2)));
              }}
              onReloadFromFile={async () => {
                const text = await fileSaving.reloadExternal();
                if (text) {
                  try {
                    const parsed = parseDiagramFile(text);
                    replaceDocumentContents(activeDoc, parsed);
                  } catch (err) {
                    console.warn(err);
                  }
                }
              }}
              onOverwriteFile={() =>
                fileSaving.overwrite(JSON.stringify(buildCurrentFile(), null, 2))
              }
              onStopFile={fileSaving.detach}
              fileName={fileSaving.signals.fileAttachment?.fileName ?? fileSaving.fileName}
              onLoginOidc={collab.isOidcAvailable ? collab.handleLoginOidc : undefined}
              isOidcAvailable={collab.isOidcAvailable}
              isLoggedIn={Boolean(collab.storeIdentity)}
              onSaveToWorkspace={storeUrl ? onSaveToWorkspace : undefined}
              isSavingToWorkspace={isSavingToWorkspace}
            />
          }
          collabPanel={
            <CollabPanel
              signalingConfigured={collab.signalingConfigured}
              signalingUrlsInput={collab.signalingUrlsInput}
              onSignalingUrlsInputChange={collab.onSignalingUrlsInputChange}
              buildTimeSignalingDefault={collab.buildTimeSignalingDefault}
              iceServersInput={collab.iceServersInput}
              onIceServersInputChange={collab.onIceServersInputChange}
              buildTimeIceServersDefault={collab.buildTimeIceServersDefault}
              activeSession={
                collab.activeSession
                  ? {
                      roomName: collab.activeSession.roomName,
                      password: collab.activeSession.password,
                      isSynced: () => collab.sessionPersistence.state === 'active',
                      relayConnected: collab.relayConnected,
                      peers: collab.presencePeers,
                    }
                  : null
              }
              onStartSession={collab.handleStartSession}
              onJoinSession={collab.handleJoinSession}
              onLeaveSession={requestLeave}
              displayName={collab.displayName}
              onDisplayNameChange={collab.onDisplayNameChange}
              showPeerCursors={collab.showPeerCursors}
              onShowPeerCursorsChange={collab.setShowPeerCursors}
              resumableRoom={collab.activeSession ? null : resumableSession?.room}
              onResumeSession={
                resumableSession
                  ? () =>
                      collab.handleStartSession(
                        resumableSession.key,
                        resumableSession.room,
                        resumableSession.relay,
                      )
                  : undefined
              }
              onCopyLink={() => showToast('Session link copied to clipboard')}
            />
          }
        />

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="application/json"
          onChange={onLoadFile}
        />

        <AccessRequestNotice
          requests={collab.accessRequests.requests}
          granting={collab.accessRequests.granting}
          onGrant={collab.accessRequests.grant}
          autoGranted={collab.accessRequests.autoGranted}
          onDismissAutoGranted={collab.accessRequests.dismissAutoGranted}
          rotating={collab.accessRequests.rotating}
        />

        <div className="app__body">
          {viewMode === 'diagram' && (
            <>
              {!scenarioRunner.isPresenting && (
                <div className="app__sidebar-wrap app__sidebar-wrap--left">
                  {!isPaletteCollapsed && <Palette />}
                  <button
                    type="button"
                    className="app__sidebar-toggle"
                    onClick={() => setIsPaletteCollapsed((c) => !c)}
                    title={isPaletteCollapsed ? 'Expand Palette' : 'Collapse Palette'}
                  >
                    {isPaletteCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
                  </button>
                </div>
              )}

              <div className="app__canvas-column">
                <Canvas
                  nodes={canvasOps.nodes}
                  edges={canvasOps.edges}
                  onNodesChange={canvasOps.onNodesChange}
                  onEdgesChange={canvasOps.onEdgesChange}
                  onConnect={canvasOps.onConnect}
                  onAddNode={canvasOps.onAddNode}
                  onAddGroup={canvasOps.onAddGroup}
                  onAddText={canvasOps.onAddText}
                  onAddShape={canvasOps.onAddShape}
                  onAddCode={canvasOps.onAddCode}
                  onUpdateNode={canvasOps.onUpdateNode}
                  onUpdateEdge={canvasOps.onUpdateEdge}
                  onReconnectEdge={canvasOps.onReconnectEdge}
                  onAddEdgeWaypoint={canvasOps.onAddEdgeWaypoint}
                  onMoveEdgeWaypoint={canvasOps.onMoveEdgeWaypoint}
                  onRemoveEdgeWaypoint={canvasOps.onRemoveEdgeWaypoint}
                  onEndEdgeGesture={canvasOps.onEndEdgeGesture}
                  onPreviewEdgeLabel={canvasOps.onPreviewEdgeLabel}
                  onReparentNode={canvasOps.onReparentNode}
                  onAdoptIntoGroup={canvasOps.onAdoptIntoGroup}
                  onZOrderCommand={canvasOps.onZOrderCommand}
                  presentation={scenarioRunner.presentation}
                  previewFocus={scenarioRunner.previewFocus}
                  focusNodeId={focusNodeId}
                  onFocusHandled={() => setFocusNodeId(null)}
                  onPresentNext={scenarioRunner.onPresentNext}
                  onPresentPrev={scenarioRunner.onPresentPrev}
                  onExitPresenting={scenarioRunner.onExitPresenting}
                  breadcrumbLabels={canvasOps.breadcrumbLabels}
                  onDrillInto={canvasOps.onDrillInto}
                  onNavigateToRoot={canvasOps.onNavigateToRoot}
                  onNavigateToPathIndex={canvasOps.onNavigateToPathIndex}
                  isSelectMode={canvasOps.isSelectMode}
                  onToggleSelectMode={canvasOps.onToggleSelectMode}
                  peers={collab.showPeerCursors ? collab.presencePeers : []}
                  onCursorMove={collab.onCursorMove}
                />
              </div>

              {!scenarioRunner.isPresenting && (
                <div className="app__sidebar-wrap app__sidebar-wrap--right">
                  <button
                    type="button"
                    className="app__sidebar-toggle"
                    onClick={() => setIsInspectorCollapsed((c) => !c)}
                    title={isInspectorCollapsed ? 'Expand Inspector' : 'Collapse Inspector'}
                  >
                    {isInspectorCollapsed ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {!isInspectorCollapsed && (
                    <Inspector
                      selectedNode={canvasOps.selectedNode}
                      selectedEdge={canvasOps.selectedEdge}
                      onUpdateNode={canvasOps.onUpdateNode}
                      onUpdateEdge={canvasOps.onUpdateEdge}
                      onClearEdgeWaypoints={canvasOps.onClearEdgeWaypoints}
                      onRemoveEdgeWaypoint={canvasOps.onRemoveEdgeWaypoint}
                      onDeleteNode={canvasOps.onDeleteNode}
                      onDeleteEdge={canvasOps.onDeleteEdge}
                      onDrillInto={canvasOps.onDrillInto}
                      requirements={requirementsSnapshot}
                      onNavigateToRequirement={handleNavigateToRequirement}
                      onZOrderCommand={(cmd) => canvasOps.onZOrderCommand(cmd)}
                    />
                  )}
                  {!isScenarioPanelCollapsed && (
                    <ScenarioPanel
                      scenarios={scenarios}
                      activeScenarioId={scenarioRunner.activeScenarioId}
                      activeStepId={scenarioRunner.activeStepId}
                      onSelectScenario={scenarioRunner.setActiveScenarioId}
                      onCreateScenario={scenarioRunner.onAddScenario}
                      onRenameScenario={(id, newTitle) =>
                        scenarioRunner.onUpdateScenario(id, { title: newTitle })
                      }
                      onDeleteScenario={scenarioRunner.onDeleteScenario}
                      onAddStep={scenarioRunner.onAddStep}
                      onAddSelectionToStep={scenarioRunner.onAddSelectionToStep}
                      onRemoveSelectionFromStep={scenarioRunner.onRemoveSelectionFromStep}
                      onUpdateStep={scenarioRunner.onUpdateStep}
                      onDeleteStep={scenarioRunner.onDeleteStep}
                      onMoveStep={scenarioRunner.onMoveStep}
                      onPresent={scenarioRunner.onStartPresenting}
                      canAddStep={
                        canvasOps.selectedNodeIds.length > 0 || canvasOps.selectedEdgeIds.length > 0
                      }
                      onSelectStep={scenarioRunner.setActiveStepId}
                      diagramNodes={diagramSnapshot.nodes}
                      currentPath={canvasOps.path}
                      onClose={() => setIsScenarioPanelCollapsed(true)}
                    />
                  )}
                </div>
              )}
            </>
          )}

          {viewMode === 'requirements' && (
            <RequirementsView
              requirementsStore={requirementsStore}
              programIncrements={programIncrementsSnapshot}
              team={teamSnapshot}
              diagramRoot={diagramSnapshot}
              onNavigateToNode={handleNavigateToNode}
              onCreateLinkedNode={handleCreateLinkedNode}
              focusItemId={focusRequirementId}
              onFocusHandled={() => setFocusRequirementId(null)}
              peers={collab.presencePeers}
            />
          )}

          {viewMode === 'timeline' && (
            <TimelineView
              programIncrementsStore={programIncrementsStore}
              requirementsStore={requirementsStore}
              milestonesStore={milestonesStore}
              team={teamSnapshot}
              diagramRoot={diagramSnapshot}
              onNavigateToNode={handleNavigateToNode}
              onCreateLinkedNode={handleCreateLinkedNode}
              onNavigateToRequirement={handleNavigateToRequirement}
              peers={collab.presencePeers}
            />
          )}

          {viewMode === 'team' && (
            <TeamView
              teamStore={teamStore}
              programIncrementsStore={programIncrementsStore}
              requirements={requirementsSnapshot}
            />
          )}

          {viewMode === 'skill-tree' && (
            <SkillTreeView
              requirementsStore={requirementsStore}
              programIncrements={programIncrementsSnapshot}
              team={teamSnapshot}
              diagramRoot={diagramSnapshot}
              onNavigateToNode={handleNavigateToNode}
              onCreateLinkedNode={handleCreateLinkedNode}
              onNavigateToRequirement={handleNavigateToRequirement}
            />
          )}
        </div>

        {isDocumentManagerOpen && (
          <DocumentManager
            isOpen={isDocumentManagerOpen}
            onClose={() => setIsDocumentManagerOpen(false)}
            library={documentLibrary}
            currentDocId={openDocId}
            onRenameCurrent={setTitle}
            onOpenDocument={openDocumentInTab}
            onNewDocument={onNew}
            timedCopies={timedCopies}
            onTimedCopiesChange={setTimedCopies}
            workspace={
              storeUrl ? (
                <WorkspacePanel
                  storeUrl={storeUrl}
                  currentDocId={openDocId}
                  currentTitle={title}
                  getDocumentState={() => Y.encodeStateAsUpdate(activeDoc)}
                  onOpenDocument={openDocumentInTab}
                />
              ) : undefined
            }
          />
        )}

        {isLibraryOpen && (
          <LibraryManagerModal isOpen={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} />
        )}

        <LeaveGuardDialog
          isOpen={isLeaveGuardOpen}
          onStay={() => setIsLeaveGuardOpen(false)}
          onLeave={() => {
            setIsLeaveGuardOpen(false);
            collab.leaveSession();
          }}
          onExportAndLeave={() => {
            onSave();
            setIsLeaveGuardOpen(false);
            collab.leaveSession();
          }}
        />

        {appExport.isSrdModalOpen && appExport.srdModalData && (
          <SrdPrintModal
            isOpen={appExport.isSrdModalOpen}
            srdData={appExport.srdModalData}
            onClose={() => appExport.setIsSrdModalOpen(false)}
          />
        )}

        {(appExport.isGeneratingSrd ||
          (collab.activeSession?.autoJoined && diagramSnapshot.nodes.length === 0)) && (
          <div className="srd-loading-overlay" role="status" aria-live="polite">
            <div className="srd-loading-overlay__content">
              <div className="srd-loading-overlay__spinner" />
              <div className="srd-loading-overlay__text">
                {appExport.isGeneratingSrd
                  ? 'Capturing diagram snapshots...'
                  : 'Connecting to session...'}
              </div>
            </div>
          </div>
        )}

        {toast && (
          <Toast
            key={toast.id}
            message={toast.message}
            description={toast.description}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </ReactFlowProvider>
  );
}

export default App;
