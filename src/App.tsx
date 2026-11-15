import {
  lazy,
  Profiler,
  type ProfilerOnRenderCallback,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as Y from 'yjs';
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
import { PlanNav } from './components/plan/PlanNav';
import { planSectionFor } from './app/planNavigation';
import { DependenciesView } from './components/dependencies/DependenciesView';
import { DocumentManager } from './components/workspace/DocumentManager';
import { DurabilityIndicator } from './components/workspace/DurabilityIndicator';
import { LeaveGuardDialog } from './components/workspace/LeaveGuardDialog';
import { TrustedWorkspacePanel } from './components/workspace/TrustedWorkspacePanel';
import { useTrustedWorkspaceSync } from './collab/trusted/useTrustedWorkspaceSync';
import { getStoreMode } from './collab/trusted/storeMode';
import { StoreConnection } from './components/workspace/StoreConnection';
import { Toast, type ToastType } from './common/components/toast/Toast';
import { useFileSaving } from './hooks/useFileSaving';
import { getStoreUrl } from './domain/storage/storeConfig';
import { isSoleReplicaHolder } from './domain/storage/durability';
import { isPerfInstrumentationActive, recordCommit } from './perf/instrumentation';
import { useOpenDocument } from './app/hooks/useOpenDocument';
import { useStoreSignIn } from './app/hooks/useStoreSignIn';
import { useViewOnly } from './app/hooks/useViewOnly';
import { useCollabSession } from './app/hooks/useCollabSession';
import { useDocumentStores } from './app/hooks/useDocumentStores';
import { useDocumentSessionJoin } from './app/hooks/useDocumentSessionJoin';
import { useDocumentPersistence } from './app/hooks/useDocumentPersistence';
import { useDiagramSelection } from './app/hooks/useDiagramSelection';
import { useScenarios } from './app/hooks/useScenarios';
import { useViewNavigation } from './app/hooks/useViewNavigation';
import { useCanvasEditing } from './app/hooks/useCanvasEditing';
import { useClipboard } from './app/hooks/useClipboard';
import { useStyleClipboard } from './app/hooks/useStyleClipboard';
import type { CanvasContextActions } from './components/canvas/useCanvasContextMenu';
import type { MultiSelectionActions } from './components/canvas/MultiSelectionInspector';
import { useKeyboardShortcuts } from './app/hooks/useKeyboardShortcuts';
import { useFileActions } from './app/hooks/useFileActions';
import { usePerfHarnessBridge } from './app/hooks/usePerfHarnessBridge';
import { listLinkableDocuments, listWorkspaceDocuments } from './collab/sync/linkableDocuments';
import { createTrustedStoreClient } from './collab/trusted/trustedStoreClient';
import './App.css';

// Loaded on first visit: the SRD view carries the PDF exporter, which no
// other view needs, so it stays out of the bundle every session downloads.
const SrdView = lazy(() => import('./components/srd/SrdViewEntry'));
// Loaded when a scenario is first exported: its encoders (react-pdf, gifenc,
// Mediabunny) load later still, each only for its own format.
const ScenarioExportDialog = lazy(
  () => import('./components/canvas/scenarioExport/ScenarioExportDialog'),
);

/**
 * The editor shell: wires the app's hooks together and lays out the views.
 *
 * PERFORMANCE - read src/app/README.md before changing this file. In short:
 *
 * - The hooks below run inside this component's render. They split the code
 *   up without adding a component, a render or a commit, which is why the
 *   logic lives in hooks rather than in child components.
 * - Always destructure a hook's result, and depend on its members. Its
 *   returned object is new on every render: a callback or effect that lists
 *   it re-runs on every render, and anything memoized that receives it
 *   re-renders. That is what took techdebt/deconstruction from 23 node
 *   renders per drag to 8,421.
 * - Hook order is significant: effects run in declaration order, and some
 *   hooks read values only an earlier one produces. The order below keeps
 *   every effect in the same relative order it had when all of this lived in
 *   one function.
 * - Canvas is not memoized, so every render here is a Canvas render (the
 *   perf harness's canvasRenders counter). Never add state here that
 *   changes during a drag unless the canvas needs it.
 */
function App() {
  // --- The open document --------------------------------------------------
  const { openDocId, openDoc, documentStore, documentLibrary, openDocumentInTab } =
    useOpenDocument();
  const [isDocumentManagerOpen, setIsDocumentManagerOpen] = useState(false);
  /** The file this document is continuously saved to, if any (WS13-R1). */
  const fileSaving = useFileSaving(openDocId);
  /** Where the workspace is, if this deployment has one. Absent means the
   * editor behaves exactly as it does with no store at all. */
  const [storeUrl] = useState(() => getStoreUrl());
  /**
   * Whether that store is one this editor can use, settled before the
   * first render (see storeMode.ts). A store that predates workspaces is
   * not: the editor then works on its own, and File > Documents says why.
   */
  const [storeMode] = useState(() => getStoreMode(storeUrl));
  const trustedStoreUrl = storeMode === 'trusted' ? storeUrl : null;

  const [toast, setToast] = useState<{
    id?: number;
    message: string;
    description?: string;
    type?: ToastType;
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: ToastType = 'success', description?: string) => {
      setToast({ id: Date.now(), message, type, description });
    },
    [],
  );

  // --- Workspace sign-in and collaboration --------------------------------
  const { storeIdentity, isOidcAvailable, handleLoginOidc, signedInName } =
    useStoreSignIn(trustedStoreUrl);

  /**
   * A relay token for the open document's room, where a trusted store
   * gives them out with the document. Filled in further down, once the
   * hook that knows the document's session has run; stable, so the session
   * code can hold on to it.
   */
  const documentRelayToken = useRef<((room: string) => Promise<string | null | undefined>) | null>(
    null,
  );
  const relayTokenFor = useCallback(async (room: string) => documentRelayToken.current?.(room), []);

  const {
    activeSession,
    setActiveSession,
    activeSessionRef,
    autoJoinedRoom,
    presenceName,
    onDisplayNameChange,
    showPeerCursors,
    setShowPeerCursors,
    presencePeers,
    sessionPersistence,
    relayConnected,
    broadcastPresence,
    onCursorMove,
    buildTimeSignalingDefault,
    signalingUrlsInput,
    setSignalingUrlsInput,
    signalingUrls,
    buildTimeIceServersDefault,
    iceServersInput,
    setIceServersInput,
    iceServers,
    startNewSession,
    joinSession,
    leaveSession,
  } = useCollabSession({
    openDoc,
    storeUrl: trustedStoreUrl,
    signedInName,
    showToast,
    relayTokenFor,
  });

  const appVersion = useMemo(
    () => (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'Development',
    [],
  );

  // --- The document's stores ----------------------------------------------
  const {
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
  } = useDocumentStores({ activeSession, openDoc });

  const workspaceSync = useTrustedWorkspaceSync({
    storeUrl: trustedStoreUrl,
    docId: openDocId,
    doc: openDoc.doc,
    title,
  });
  // The workspace this document is in, when this person may read it but
  // not change it. Edits are then refused at the document (useViewOnly),
  // and the toolbar and canvas stop offering the obvious ones.
  const viewOnlyIn = workspaceSync.readOnly
    ? (workspaceSync.workspace?.name ?? 'this workspace')
    : null;
  useViewOnly({ doc: openDoc.doc, viewOnlyIn, showToast });
  useDocumentSessionJoin({
    session: workspaceSync.session,
    // The session code is set up before the hook above runs, so it
    // reaches that hook's answer through this ref.
    relayTokenRef: documentRelayToken,
    relayTokenProvider: trustedStoreUrl ? workspaceSync.relayTokenFor : null,
    openDocId,
    signalingUrls,
    activeSessionRef,
    autoJoinedRoomRef: autoJoinedRoom,
    startNewSession,
  });

  const { durabilitySignals, resumableSession, activeDocId } = useDocumentPersistence({
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
  });

  // --- Diagram level, selection, scenarios and views ----------------------
  const {
    path,
    setPath,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    breadcrumbLabels,
  } = useDiagramSelection({ activeSession, broadcastPresence, diagramSnapshot });

  const {
    setActiveScenarioId,
    setActiveStepIndex,
    isPresenting,
    setIsPresenting,
    activeStepId,
    setActiveStepId,
    activeScenario,
    onCreateScenario,
    onRenameScenario,
    onDeleteScenario,
    onDuplicateScenario,
    onSelectScenario,
    onSelectStep,
    onAddStep,
    onAddSelectionToStep,
    onRemoveSelectionFromStep,
    onUpdateStep,
    onDeleteStep,
    onDuplicateStep,
    onMoveStep,
    previewFocus,
    onStartPresenting,
    onExitPresenting,
    onPresentNext,
    onPresentPrev,
    presentation,
  } = useScenarios({
    scenarios,
    setScenarios,
    path,
    setPath,
    selectedNodeIds,
    selectedEdgeIds,
    setSelectedNodeIds,
    setSelectedEdgeIds,
  });

  const {
    viewMode,
    setViewMode,
    planChartMode,
    openPlan,
    openPlanSection,
    diagramTree,
    setFocusedItemId,
    pendingRequirementFocus,
    onFocusRequirementHandled,
    onNavigateToRequirement,
    pendingNodeFocus,
    onFocusNodeHandled,
    onNavigateToNode,
    onCreateLinkedNode,
  } = useViewNavigation({
    activeSession,
    broadcastPresence,
    diagramSnapshot,
    diagramStore,
    setPath,
    setSelectedNodeIds,
    setSelectedEdgeIds,
  });
  // Stable, so the export menu's props do not change identity per render.
  const openSrdView = useCallback(() => setViewMode('srd'), [setViewMode]);

  const [isScenarioPanelOpen, setIsScenarioPanelOpen] = useState(false);
  const [exportScenarioId, setExportScenarioId] = useState<string | null>(null);
  const closeScenarioExport = useCallback(() => setExportScenarioId(null), []);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);

  // --- Canvas editing -----------------------------------------------------
  const {
    nodes,
    edges,
    portNodes,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onAddNode,
    onAddGroup,
    onAddText,
    onAddShape,
    onAddCode,
    onReparentNode,
    onAdoptIntoGroup,
    onUpdateNode,
    onUpdateNodes,
    onSetLocked,
    onGroup,
    onUngroup,
    onArrange,
    onZOrderCommand,
    onUpdateEdge,
    onUpdateEdges,
    onReconnectEdge,
    onAddEdgeWaypoint,
    onMoveEdgeWaypoint,
    onPreviewEdgeLabel,
    onEndEdgeGesture,
    onRemoveEdgeWaypoint,
    onClearEdgeWaypoints,
    onDeleteNode,
    onDeleteEdge,
    onDeleteSelection,
    onDrillInto,
    onNavigateToRoot,
    onNavigateToPathIndex,
  } = useCanvasEditing({
    diagramStore,
    diagramSnapshot,
    undo,
    activeSession,
    presencePeers,
    broadcastPresence,
    path,
    setPath,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    isPresenting,
    setActiveStepId,
  });

  const { onCopy, onPaste, onDuplicate, onSaveFragment, onInsertFragment } = useClipboard({
    nodes,
    edges,
    selectedNodeIds,
    diagramStore,
    path,
    setSelectedNodeIds,
    setSelectedEdgeIds,
  });

  // Saving a fragment says where it went, since nothing on the canvas
  // changes; read only by the right-click menu, like onDuplicate.
  const onSaveFragmentWithToast = useCallback(
    (nodeIds: string[], name: string) => {
      const result = onSaveFragment(nodeIds, name);
      if (result.ok) {
        showToast(`Saved "${result.fragment.name}" to Fragments in the palette`);
      } else if (result.reason === 'too-large') {
        showToast('That selection is too large to save as a fragment', 'error');
      } else if (result.reason === 'storage') {
        showToast('The fragment could not be saved in this browser', 'error');
      }
    },
    [onSaveFragment, showToast],
  );

  const { copiedStyle, onCopyStyle, onPasteStyle } = useStyleClipboard({
    nodes,
    edges,
    onUpdateNodes,
    onUpdateEdges,
  });

  const onUndo = useCallback(() => {
    if (isPresenting) return;
    undo.undo();
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [isPresenting, undo, setSelectedNodeIds, setSelectedEdgeIds]);

  const onRedo = useCallback(() => {
    if (isPresenting) return;
    undo.redo();
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [isPresenting, undo, setSelectedNodeIds, setSelectedEdgeIds]);

  useKeyboardShortcuts({
    isPresenting,
    viewMode,
    selectedNodeIds,
    selectedEdgeIds,
    onDeleteSelection,
    onCopy,
    onPaste,
    onUndo,
    onRedo,
    onPresentNext,
    onPresentPrev,
    onExitPresenting,
    onDuplicate,
    onGroup,
    onUngroup,
    onCopyStyle,
    onPasteStyle,
  });

  // --- Files and exports --------------------------------------------------
  const {
    fileInputRef,
    onNew,
    onSave,
    timedCopies,
    setTimedCopies,
    onChooseFile,
    onOverwriteFile,
    onReloadFromFile,
    onExportPng,
    onExportSvg,
    onExportRequirementsMarkdown,
    onLoadClick,
    onFileSelected,
  } = useFileActions({
    openDocumentInTab,
    fileSaving,
    openDoc,
    activeDoc,
    undo,
    showToast,
    title,
    scenarios,
    nodes,
    diagramSnapshot,
    requirementsSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    milestonesSnapshot,
    srdSnapshot,
    setPath,
    setActiveScenarioId,
    setActiveStepIndex,
    setIsPresenting,
  });

  /**
   * WS13-R11: leaving when nobody else here holds a saved copy needs an
   * explicit confirmation that says what that means.
   */
  const [isLeaveGuardOpen, setIsLeaveGuardOpen] = useState(false);
  const requestLeave = useCallback(() => {
    if (isSoleReplicaHolder(durabilitySignals)) setIsLeaveGuardOpen(true);
    else leaveSession();
  }, [durabilitySignals, leaveSession]);

  usePerfHarnessBridge({
    diagramStore,
    setPath,
    setSelectedNodeIds,
    setSelectedEdgeIds,
    setActiveSession,
    signalingUrls,
    iceServers,
    leaveSession,
    activeDoc,
  });

  // --- Render -------------------------------------------------------------
  const selectedNodeId = selectedNodeIds[0] ?? null;
  const selectedEdgeId = selectedEdgeIds[0] ?? null;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  // Every selected item, for the multi-selection Inspector - only worked
  // out when there's more than one, which is the only time it's read.
  const isMultiSelection = selectedNodeIds.length + selectedEdgeIds.length > 1;
  const selectedNodes = useMemo(
    () => (isMultiSelection ? nodes.filter((n) => selectedNodeIds.includes(n.id)) : []),
    [isMultiSelection, nodes, selectedNodeIds],
  );
  const selectedEdges = useMemo(
    () => (isMultiSelection ? edges.filter((e) => selectedEdgeIds.includes(e.id)) : []),
    [isMultiSelection, edges, selectedEdgeIds],
  );
  const multiSelectionActions = useMemo<MultiSelectionActions>(
    () => ({
      onUpdateNodes,
      onUpdateEdges,
      onSetLocked,
      onGroup,
      onUngroup,
      onDeleteSelection,
      onArrange,
    }),
    [onUpdateNodes, onUpdateEdges, onSetLocked, onGroup, onUngroup, onDeleteSelection, onArrange],
  );
  // Only ever read by the right-click menu, which Canvas renders while it's
  // open - so this changing identity never reaches a node or edge.
  const canvasContextActions = useMemo<CanvasContextActions>(
    () => ({
      onUpdateNodes,
      onUpdateEdges,
      onDuplicate,
      onSaveFragment: onSaveFragmentWithToast,
      onGroup,
      onUngroup,
      onSetLocked,
      onCopyStyle,
      onPasteStyle,
      copiedStyle,
      requirements: requirementsSnapshot,
      onArrange,
    }),
    [
      onUpdateNodes,
      onUpdateEdges,
      onDuplicate,
      onSaveFragmentWithToast,
      onGroup,
      onUngroup,
      onSetLocked,
      onCopyStyle,
      onPasteStyle,
      copiedStyle,
      requirementsSnapshot,
      onArrange,
    ],
  );
  const onCanvasProfilerRender: ProfilerOnRenderCallback = useCallback(
    (_id, _phase, actualDuration) => {
      recordCommit(actualDuration);
    },
    [],
  );

  const canvasElement = (
    <Canvas
      nodes={nodes}
      edges={edges}
      portNodes={portNodes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      peers={
        !activeSession
          ? []
          : presencePeers.map((p) => {
              const onSamePath = p.diagramPath === path.join('/');
              const shouldShowCursor = showPeerCursors && onSamePath;
              return p.cursor === null || shouldShowCursor ? p : { ...p, cursor: null };
            })
      }
      onCursorMove={onCursorMove}
      onConnect={onConnect}
      onAddNode={onAddNode}
      onAddGroup={onAddGroup}
      onAddText={onAddText}
      onAddShape={onAddShape}
      onAddCode={onAddCode}
      onInsertFragment={onInsertFragment}
      onUpdateNode={onUpdateNode}
      onUpdateEdge={onUpdateEdge}
      onReconnectEdge={onReconnectEdge}
      onAddEdgeWaypoint={onAddEdgeWaypoint}
      onMoveEdgeWaypoint={onMoveEdgeWaypoint}
      onEndEdgeGesture={onEndEdgeGesture}
      onPreviewEdgeLabel={onPreviewEdgeLabel}
      onRemoveEdgeWaypoint={onRemoveEdgeWaypoint}
      onReparentNode={onReparentNode}
      onAdoptIntoGroup={onAdoptIntoGroup}
      onZOrderCommand={onZOrderCommand}
      presentation={presentation}
      viewOnly={viewOnlyIn !== null}
      previewFocus={previewFocus}
      focusNodeId={pendingNodeFocus}
      onFocusHandled={onFocusNodeHandled}
      onPresentNext={onPresentNext}
      onPresentPrev={onPresentPrev}
      onExitPresenting={onExitPresenting}
      breadcrumbLabels={breadcrumbLabels}
      onDrillInto={onDrillInto}
      onNavigateToRoot={onNavigateToRoot}
      onNavigateToPathIndex={onNavigateToPathIndex}
      isSelectMode={isSelectMode}
      onToggleSelectMode={() => setIsSelectMode((v) => !v)}
      contextActions={canvasContextActions}
    />
  );

  const getDocumentState = useCallback(() => Y.encodeStateAsUpdate(openDoc.doc), [openDoc.doc]);
  // The Inspector's "Linked document" picker reads the catalogue on demand:
  // this browser's documents and, where there is a store, the workspaces'
  // (see linkableDocuments.ts). Either source failing leaves the other's
  // documents available - the field is a convenience, and the Documents
  // dialog is where storage problems are reported. The client is created
  // once, and only the first time a node is inspected.
  const workspaceReader = useRef<ReturnType<typeof createTrustedStoreClient> | null>(null);
  const listStoredDocuments = useCallback(
    () =>
      listLinkableDocuments({
        listLocal: () =>
          documentStore.listDocuments().then((result) => (result.ok ? result.value : [])),
        listWorkspace: trustedStoreUrl
          ? () => {
              workspaceReader.current ??= createTrustedStoreClient({ baseUrl: trustedStoreUrl });
              return listWorkspaceDocuments(workspaceReader.current);
            }
          : undefined,
      }),
    [documentStore, trustedStoreUrl],
  );
  const handleOpenWorkspaceDocument = useCallback(
    (docId: string) => {
      setIsDocumentManagerOpen(false);
      openDocumentInTab(docId);
    },
    [openDocumentInTab],
  );

  const planSection = planSectionFor(viewMode, planChartMode);

  return (
    <div className="app">
      {appVersion && <div className="app-version">{appVersion}</div>}
      {!isPresenting && (
        <Toolbar
          title={title}
          onTitleChange={setTitle}
          viewOnlyIn={viewOnlyIn}
          onNew={onNew}
          onOpenDocuments={() => setIsDocumentManagerOpen(true)}
          onSave={onSave}
          onLoadClick={onLoadClick}
          isScenarioPanelOpen={isScenarioPanelOpen}
          onToggleScenarioPanel={() => setIsScenarioPanelOpen((v) => !v)}
          onExportPng={onExportPng}
          onExportSvg={onExportSvg}
          onOpenSrd={openSrdView}
          canExport={nodes.length > 0}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          onOpenPlan={openPlan}
          onExportRequirementsMarkdown={onExportRequirementsMarkdown}
          canExportRequirements={requirementsSnapshot.items.length > 0}
          onManageLibraries={() => setIsLibraryModalOpen(true)}
          durabilityIndicator={
            <DurabilityIndicator
              signals={durabilitySignals}
              onExport={onSave}
              onChooseFile={onChooseFile}
              onResumeFile={() => void fileSaving.resume()}
              onReloadFromFile={() => void onReloadFromFile()}
              onOverwriteFile={onOverwriteFile}
              onStopFile={
                fileSaving.fileName && !activeSession?.ownsDocument
                  ? () => void fileSaving.detach()
                  : undefined
              }
              fileName={activeSession?.ownsDocument ? null : fileSaving.fileName}
              isOidcAvailable={isOidcAvailable}
              onLoginOidc={!storeIdentity && isOidcAvailable ? handleLoginOidc : undefined}
              isLoggedIn={storeIdentity !== null}
              onAddToWorkspace={
                trustedStoreUrl && storeIdentity !== null && !workspaceSync.active
                  ? () => setIsDocumentManagerOpen(true)
                  : undefined
              }
            />
          }
          // A workspace session does not lock the document: see
          // ActiveCollabSession.autoJoined.
          isInSession={!!activeSession && !activeSession.autoJoined}
          collabPanel={
            <CollabPanel
              signalingConfigured={signalingUrls.length > 0}
              signalingUrlsInput={signalingUrlsInput}
              onSignalingUrlsInputChange={setSignalingUrlsInput}
              buildTimeSignalingDefault={buildTimeSignalingDefault}
              iceServersInput={iceServersInput}
              onIceServersInputChange={setIceServersInput}
              buildTimeIceServersDefault={buildTimeIceServersDefault}
              activeSession={
                activeSession
                  ? {
                      roomName: activeSession.roomName,
                      password: activeSession.password,
                      isSynced: () => activeSession.session.isSynced(),
                      relayConnected,
                      peers: presencePeers,
                    }
                  : null
              }
              workspace={
                workspaceSync.workspace
                  ? {
                      name: workspaceSync.workspace.name,
                      onManage: () => setIsDocumentManagerOpen(true),
                    }
                  : null
              }
              displayName={presenceName}
              onDisplayNameChange={onDisplayNameChange}
              showPeerCursors={showPeerCursors}
              onShowPeerCursorsChange={setShowPeerCursors}
              onStartSession={startNewSession}
              resumableRoom={resumableSession?.room ?? null}
              onResumeSession={
                resumableSession
                  ? () => startNewSession(resumableSession.key, resumableSession.room)
                  : undefined
              }
              onJoinSession={joinSession}
              onLeaveSession={requestLeave}
              onCopyLink={() => showToast('Session link copied to clipboard')}
            />
          }
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />
      <div className="app__body">
        {viewMode === 'diagram' && (
          <>
            {!isPresenting && !isScenarioPanelOpen && (
              <div
                className={`app__sidebar-wrap app__sidebar-wrap--left${isPaletteCollapsed ? ' is-collapsed' : ''}`}
              >
                <Palette collapsed={isPaletteCollapsed} onCollapsedChange={setIsPaletteCollapsed} />
              </div>
            )}
            <div className="app__canvas-column" style={{ position: 'relative' }}>
              <ReactFlowProvider>
                {isPerfInstrumentationActive() ? (
                  <Profiler id="CanvasProfiler" onRender={onCanvasProfilerRender}>
                    {canvasElement}
                  </Profiler>
                ) : (
                  canvasElement
                )}
              </ReactFlowProvider>
            </div>
            {!isPresenting && (
              <div
                className={`app__sidebar-wrap app__sidebar-wrap--right${
                  !isScenarioPanelOpen && isInspectorCollapsed ? ' is-collapsed' : ''
                }`}
              >
                {isScenarioPanelOpen ? (
                  <ScenarioPanel
                    scenarios={scenarios}
                    activeScenarioId={activeScenario?.id ?? null}
                    onSelectScenario={onSelectScenario}
                    onCreateScenario={onCreateScenario}
                    onRenameScenario={onRenameScenario}
                    onDeleteScenario={onDeleteScenario}
                    onDuplicateScenario={onDuplicateScenario}
                    onAddStep={onAddStep}
                    onAddSelectionToStep={onAddSelectionToStep}
                    onRemoveSelectionFromStep={onRemoveSelectionFromStep}
                    onUpdateStep={onUpdateStep}
                    onDeleteStep={onDeleteStep}
                    onDuplicateStep={onDuplicateStep}
                    onMoveStep={onMoveStep}
                    onPresent={onStartPresenting}
                    onExport={setExportScenarioId}
                    selectedNodeIds={selectedNodeIds}
                    selectedEdgeIds={selectedEdgeIds}
                    activeStepId={activeStepId}
                    onSelectStep={onSelectStep}
                    diagramNodes={diagramSnapshot.nodes}
                    currentPath={path}
                    onClose={() => {
                      setIsScenarioPanelOpen(false);
                      setActiveStepId(null);
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="app__sidebar-toggle app__sidebar-toggle--right"
                      onClick={() => setIsInspectorCollapsed((v) => !v)}
                      title={isInspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
                      aria-label={isInspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
                    >
                      {isInspectorCollapsed ? (
                        <ChevronLeft size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                    </button>
                    {!isInspectorCollapsed && (
                      <Inspector
                        selectedNode={selectedNode}
                        selectedEdge={selectedEdge}
                        onUpdateNode={onUpdateNode}
                        onUpdateEdge={onUpdateEdge}
                        onClearEdgeWaypoints={onClearEdgeWaypoints}
                        onRemoveEdgeWaypoint={onRemoveEdgeWaypoint}
                        onDeleteNode={onDeleteNode}
                        onDeleteEdge={onDeleteEdge}
                        onDrillInto={onDrillInto}
                        requirements={requirementsSnapshot}
                        onNavigateToRequirement={onNavigateToRequirement}
                        onZOrderCommand={onZOrderCommand}
                        currentDocId={openDocId}
                        listDocuments={listStoredDocuments}
                        selectedNodes={selectedNodes}
                        selectedEdges={selectedEdges}
                        multiSelection={multiSelectionActions}
                      />
                    )}
                  </>
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
            diagramRoot={diagramTree}
            onNavigateToNode={onNavigateToNode}
            onCreateLinkedNode={onCreateLinkedNode}
            focusItemId={pendingRequirementFocus}
            onFocusHandled={onFocusRequirementHandled}
            peers={activeSession ? presencePeers.filter((p) => p.viewMode === 'requirements') : []}
            onFocusedItemChange={setFocusedItemId}
            documentId={activeDocId}
          />
        )}
        {planSection && (
          // One column for the whole Plan tab: its section links, then
          // whichever section is showing. The sections are unchanged
          // children; only the wrapper is new.
          <div className="plan-view">
            <PlanNav section={planSection} onSelect={openPlanSection} />
            {viewMode === 'timeline' && (
              <TimelineView
                programIncrementsStore={programIncrementsStore}
                requirementsStore={requirementsStore}
                milestonesStore={milestonesStore}
                team={teamSnapshot}
                diagramRoot={diagramTree}
                onNavigateToNode={onNavigateToNode}
                onCreateLinkedNode={onCreateLinkedNode}
                onNavigateToRequirement={onNavigateToRequirement}
                peers={activeSession ? presencePeers.filter((p) => p.viewMode === 'timeline') : []}
                onFocusedItemChange={setFocusedItemId}
                chartMode={planChartMode}
                documentId={activeDocId}
              />
            )}
            {viewMode === 'team' && (
              <TeamView
                teamStore={teamStore}
                programIncrementsStore={programIncrementsStore}
                requirements={requirementsSnapshot}
              />
            )}
            {viewMode === 'dependencies' && (
              <DependenciesView
                requirementsStore={requirementsStore}
                programIncrements={programIncrementsSnapshot}
                team={teamSnapshot}
                diagramRoot={diagramTree}
                onNavigateToNode={onNavigateToNode}
                onCreateLinkedNode={onCreateLinkedNode}
                onNavigateToRequirement={onNavigateToRequirement}
              />
            )}
          </div>
        )}
        {viewMode === 'srd' && (
          <Suspense fallback={null}>
            <SrdView
              srdStore={srdStore}
              title={title}
              diagramSnapshot={diagramSnapshot}
              requirementsSnapshot={requirementsSnapshot}
              milestonesSnapshot={milestonesSnapshot}
              programIncrementsSnapshot={programIncrementsSnapshot}
              teamSnapshot={teamSnapshot}
            />
          </Suspense>
        )}
      </div>
      <LeaveGuardDialog
        isOpen={isLeaveGuardOpen}
        onStay={() => setIsLeaveGuardOpen(false)}
        onExportAndLeave={() => {
          onSave();
          setIsLeaveGuardOpen(false);
          leaveSession();
        }}
        onLeave={() => {
          setIsLeaveGuardOpen(false);
          leaveSession();
        }}
      />
      <DocumentManager
        isOpen={isDocumentManagerOpen}
        onClose={() => setIsDocumentManagerOpen(false)}
        library={documentLibrary}
        currentDocId={openDocId}
        onRenameCurrent={setTitle}
        timedCopies={timedCopies}
        onTimedCopiesChange={setTimedCopies}
        workspace={
          <>
            <StoreConnection storeUrl={storeUrl} unsupported={storeMode === 'outdated'} />
            {trustedStoreUrl ? (
              <TrustedWorkspacePanel
                storeUrl={trustedStoreUrl}
                currentDocId={openDocId}
                currentTitle={title}
                onOpenDocument={handleOpenWorkspaceDocument}
                getDocumentState={getDocumentState}
                onSignIn={isOidcAvailable ? handleLoginOidc : undefined}
              />
            ) : null}
          </>
        }
        onOpenDocument={openDocumentInTab}
        onNewDocument={onNew}
      />
      <LibraryManagerModal
        isOpen={isLibraryModalOpen}
        onClose={() => setIsLibraryModalOpen(false)}
      />
      {exportScenarioId &&
        (() => {
          const scenario = scenarios.find((sc) => sc.id === exportScenarioId);
          return scenario ? (
            <Suspense fallback={null}>
              <ScenarioExportDialog
                scenario={scenario}
                diagramSnapshot={diagramSnapshot}
                documentTitle={title}
                onClose={closeScenarioExport}
              />
            </Suspense>
          ) : null;
        })()}
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
  );
}

export default App;
