import { useCallback, useMemo, useState, Profiler, type ProfilerOnRenderCallback } from 'react';
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
import { SkillTreeView } from './components/skilltree/SkillTreeView';
import { DocumentManager } from './components/workspace/DocumentManager';
import { DurabilityIndicator } from './components/workspace/DurabilityIndicator';
import { LeaveGuardDialog } from './components/workspace/LeaveGuardDialog';
import { WorkspacePanel } from './components/workspace/WorkspacePanel';
import { AccessRequestNotice } from './components/workspace/AccessRequestNotice';
import { SrdPrintModal } from './components/srd/SrdPrintModal';
import { Toast, type ToastType } from './common/components/toast/Toast';
import { useFileSaving } from './hooks/useFileSaving';
import { useAccessRequests } from './collab/hooks/useAccessRequests';
import { getStoreUrl } from './domain/storage/storeConfig';
import { isSoleReplicaHolder } from './domain/storage/durability';
import { recordCommit, isPerfInstrumentationActive } from './perf/instrumentation';
import { useOpenDocument } from './app/hooks/useOpenDocument';
import { useStoreSignIn } from './app/hooks/useStoreSignIn';
import { useCollabSession } from './app/hooks/useCollabSession';
import { useDocumentStores } from './app/hooks/useDocumentStores';
import { useWorkspaceSession } from './app/hooks/useWorkspaceSession';
import { useDocumentPersistence } from './app/hooks/useDocumentPersistence';
import { useDiagramSelection } from './app/hooks/useDiagramSelection';
import { useScenarios } from './app/hooks/useScenarios';
import { useViewNavigation } from './app/hooks/useViewNavigation';
import { useCanvasEditing } from './app/hooks/useCanvasEditing';
import { useClipboard } from './app/hooks/useClipboard';
import { useKeyboardShortcuts } from './app/hooks/useKeyboardShortcuts';
import { useFileActions } from './app/hooks/useFileActions';
import { useSrdExport } from './app/hooks/useSrdExport';
import { usePerfHarnessBridge } from './app/hooks/usePerfHarnessBridge';
import './App.css';
import './components/srd/SrdPrintModal.css';

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
    useStoreSignIn(storeUrl);
  /** People waiting to be let into the workspace, noticed from here rather
   * than only from inside File > Documents (WS7-R8). */
  const accessRequests = useAccessRequests({ storeUrl });

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
  } = useCollabSession({ openDoc, storeUrl, signedInName, showToast });

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

  const { workspaceSync, handleSaveToWorkspace, isSavingToWorkspace } = useWorkspaceSession({
    storeUrl,
    openDocId,
    openDoc,
    title,
    showToast,
    signalingUrls,
    activeSessionRef,
    autoJoinedRoomRef: autoJoinedRoom,
    startNewSession,
  });

  const { hasAutosaved, durabilitySignals, resumableSession, activeDocId } = useDocumentPersistence(
    {
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
    },
  );

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
    onSelectScenario,
    onSelectStep,
    onAddStep,
    onAddSelectionToStep,
    onRemoveSelectionFromStep,
    onUpdateStep,
    onDeleteStep,
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

  const [isScenarioPanelOpen, setIsScenarioPanelOpen] = useState(false);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);

  // --- Canvas editing -----------------------------------------------------
  const {
    nodes,
    edges,
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
    onZOrderCommand,
    onUpdateEdge,
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

  const { onCopy, onPaste } = useClipboard({
    nodes,
    edges,
    selectedNodeIds,
    diagramStore,
    path,
    setSelectedNodeIds,
    setSelectedEdgeIds,
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

  const {
    isSrdModalOpen,
    setIsSrdModalOpen,
    srdModalData,
    isGeneratingSrd,
    openSrdModal,
    onExportSrdMarkdown,
  } = useSrdExport({
    path,
    setPath,
    title,
    diagramSnapshot,
    requirementsSnapshot,
    milestonesSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    srdSnapshot,
    showToast,
  });

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
  const canAddStep = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;
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
    />
  );

  const getDocumentState = useCallback(() => Y.encodeStateAsUpdate(openDoc.doc), [openDoc.doc]);
  const handleOpenWorkspaceDocument = useCallback(
    (docId: string) => {
      setIsDocumentManagerOpen(false);
      openDocumentInTab(docId);
    },
    [openDocumentInTab],
  );

  return (
    <div className="app">
      {appVersion && <div className="app-version">{appVersion}</div>}
      {!isPresenting && (
        <Toolbar
          title={title}
          onTitleChange={setTitle}
          onNew={onNew}
          onOpenDocuments={() => setIsDocumentManagerOpen(true)}
          onSave={onSave}
          onLoadClick={onLoadClick}
          isScenarioPanelOpen={isScenarioPanelOpen}
          onToggleScenarioPanel={() => setIsScenarioPanelOpen((v) => !v)}
          onExportPng={onExportPng}
          onExportSvg={onExportSvg}
          onExportSrdMarkdown={onExportSrdMarkdown}
          onExportSrdPrint={openSrdModal}
          canExport={nodes.length > 0}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          onExportRequirementsMarkdown={onExportRequirementsMarkdown}
          canExportRequirements={requirementsSnapshot.items.length > 0}
          onManageLibraries={() => setIsLibraryModalOpen(true)}
          hasAutosaved={hasAutosaved}
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
              onSaveToWorkspace={
                storeUrl && storeIdentity !== null ? handleSaveToWorkspace : undefined
              }
              isSavingToWorkspace={isSavingToWorkspace}
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
                {!isPaletteCollapsed && <Palette />}
                <button
                  type="button"
                  className="app__sidebar-toggle app__sidebar-toggle--left"
                  onClick={() => setIsPaletteCollapsed((v) => !v)}
                  title={isPaletteCollapsed ? 'Show component palette' : 'Hide component palette'}
                  aria-label={
                    isPaletteCollapsed ? 'Show component palette' : 'Hide component palette'
                  }
                >
                  {isPaletteCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                </button>
              </div>
            )}
            <div className="app__canvas-column" style={{ position: 'relative' }}>
              {/* Someone waiting to be let in, shown where the person who
                  can let them in is working (WS7-R8). */}
              <AccessRequestNotice
                requests={accessRequests.requests}
                granting={accessRequests.granting}
                onGrant={(userId) => {
                  void accessRequests.grant(userId).then(
                    () =>
                      showToast('Access given. They will see the workspace within a few seconds.'),
                    () => showToast('Could not give access. Try again from File > Documents.'),
                  );
                }}
                autoGranted={accessRequests.autoGranted}
                onDismissAutoGranted={accessRequests.dismissAutoGranted}
                rotating={accessRequests.rotating}
              />
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
                    onAddStep={onAddStep}
                    onAddSelectionToStep={onAddSelectionToStep}
                    onRemoveSelectionFromStep={onRemoveSelectionFromStep}
                    onUpdateStep={onUpdateStep}
                    onDeleteStep={onDeleteStep}
                    onMoveStep={onMoveStep}
                    onPresent={onStartPresenting}
                    canAddStep={canAddStep}
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
            diagramRoot={diagramTree}
            onNavigateToNode={onNavigateToNode}
            onCreateLinkedNode={onCreateLinkedNode}
            onNavigateToRequirement={onNavigateToRequirement}
          />
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
          storeUrl ? (
            <WorkspacePanel
              storeUrl={storeUrl}
              currentDocId={openDocId}
              currentTitle={title}
              // What a workspace document holds: this document's CRDT
              // state, so the workspace copy merges with everyone else's
              // rather than replacing it (WS8-R2).
              getDocumentState={getDocumentState}
              onOpenDocument={handleOpenWorkspaceDocument}
            />
          ) : undefined
        }
        onOpenDocument={openDocumentInTab}
        onNewDocument={onNew}
      />
      <LibraryManagerModal
        isOpen={isLibraryModalOpen}
        onClose={() => setIsLibraryModalOpen(false)}
      />
      {isSrdModalOpen && srdModalData && (
        <SrdPrintModal
          isOpen={isSrdModalOpen}
          onClose={() => setIsSrdModalOpen(false)}
          srdData={srdModalData}
          srdStore={srdStore}
          nodes={diagramSnapshot.nodes}
          selectedNodeIds={selectedNodeIds}
          currentPath={path}
          setPath={setPath}
        />
      )}
      {isGeneratingSrd && (
        <div className="srd-loading-overlay">
          <div className="srd-loading-spinner" />
          <div className="srd-loading-title">Preparing Solution Requirement Document...</div>
          <div className="srd-loading-desc">
            Aggregating requirements, architecture models, and generating snapshot...
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
  );
}

export default App;
