import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  type OnConnect,
  type OnConnectStart,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useUpdateNodeInternals,
  ViewportPortal,
} from '@xyflow/react';
import {MousePointer2} from 'lucide-react';
import {CANVAS_EDGE_TYPES, CANVAS_NODE_TYPES, DEFAULT_EDGE_OPTIONS, PRO_OPTIONS,} from './canvasElementTypes';
import {PresentationOverlay} from './PresentationOverlay';
import {Breadcrumb} from './Breadcrumb';
import {DocumentationPopup} from '../documentation/DocumentationPopup';
import {useDiagramHoverDocumentation} from '../documentation/useDiagramHoverDocumentation';
import type {ZOrderCommand} from '../../domain/canvas/zOrder';
import type {
  ArchEdgeData,
  ArchEdgeDataPatch,
  ArchNodeData,
  EdgeWaypoint,
  Scenario,
  ScenarioStep,
} from '../../domain/canvas/types';
import type {EdgeEndpoints} from '../../domain/canvas/edgeReconnect';
import {EdgeConnectionLine} from './edges/EdgeConnectionLine';
import type {PresenceInfo} from '../../collab/sync/session';
import {CanvasContext, type CanvasContextValue} from './CanvasContext';
import {recordCanvasRender, registerPerfViewportFramer} from '../../perf/instrumentation';
import {nodeToAlignBox} from './nodeAlignBox';
import {CanvasContextMenu} from './CanvasContextMenu';
import {useCanvasFocusSets} from './useCanvasFocusSets';
import {useEdgeConnectionGestures} from './useEdgeConnectionGestures';
import {useCanvasCreation} from './useCanvasCreation';
import {useNodeDragInteractions} from './useNodeDragInteractions';
import {useCanvasContextMenu} from './useCanvasContextMenu';
import {useCanvasFocusDisplay} from './useCanvasFocusDisplay';

export interface PresentationState {
  scenario: Scenario;
  step: ScenarioStep;
  stepIndex: number;
}

/** A lightweight preview highlight - same dim/animate treatment as PresentationState,
 * but doesn't lock editing or show the slideshow overlay. Used when authoring a
 * scenario in ScenarioPanel, so you can see what a step highlights without
 * leaving the editor. */
export interface FocusSet {
  nodeIds: string[];
  edgeIds: string[];
}

/** React Flow's instance API as Canvas uses it, for the hooks that receive parts of it. */
export type CanvasFlow = ReturnType<typeof useReactFlow<Node<ArchNodeData>>>;

export interface CanvasProps {
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
  onNodesChange: OnNodesChange<Node<ArchNodeData>>;
  onEdgesChange: OnEdgesChange<Edge<ArchEdgeData>>;
  onConnect: OnConnect;
  onAddNode: (typeId: string, position: { x: number; y: number }) => void;
  onAddGroup: (typeId: string, position: { x: number; y: number }) => void;
  /** Creates a text annotation and returns its id, so the caller can immediately put it into edit mode. */
  onAddText: (position: { x: number; y: number }) => string;
  onAddShape: (typeId: string, position: { x: number; y: number }) => void;
  /** Creates a code snippet node and returns its id, so the caller can immediately put it into edit mode. */
  onAddCode: (position: { x: number; y: number }) => string;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  onUpdateEdge: (id: string, patch: ArchEdgeDataPatch) => void;
  /** Moves one of an edge's ends onto a different node/handle. Given
   * already-resolved endpoints rather than React Flow's own Connection,
   * because working out what that Connection actually means is this
   * component's job - see handleReconnect. */
  onReconnectEdge: (edgeId: string, endpoints: EdgeEndpoints) => void;
  onAddEdgeWaypoint: (edgeId: string, index: number, waypoint: EdgeWaypoint) => void;
  onMoveEdgeWaypoint: (
    edgeId: string,
    waypointId: string,
    position: { x: number; y: number },
  ) => void;
  onEndEdgeGesture?: (edgeId: string) => void;
  onPreviewEdgeLabel?: (
    edgeId: string,
    placement: { labelAnchorT: number; labelOffsetX: number; labelOffsetY: number },
  ) => void;
  onRemoveEdgeWaypoint: (edgeId: string, waypointId: string) => void;
  onReparentNode: (nodeId: string, newParentId: string | null) => void;
  onAdoptIntoGroup: (
    groupId: string,
    nodeIds: string[],
    groupPosition?: { x: number; y: number },
  ) => void;
  /** Applies a stacking command. targetIds is explicit rather than
   * implied by the current selection, because right-clicking a node
   * that ISN'T selected should act on that node - not on whatever
   * happened to be selected beforehand. */
  onZOrderCommand: (command: ZOrderCommand, targetIds: string[]) => void;
  presentation: PresentationState | null;
  previewFocus: FocusSet | null;
  /** Set (once) to zoom/pan the camera onto a specific node - used for
   * "jump to this node" navigation from a requirement's linked-nodes list,
   * distinct from previewFocus/presentation which drive scenario-related
   * camera framing and dimming. Cleared via onFocusHandled once consumed,
   * same one-shot pattern as RequirementsView's focusItemId. */
  focusNodeId?: string | null;
  onFocusHandled?: () => void;
  onPresentNext: () => void;
  onPresentPrev: () => void;
  onExitPresenting: () => void;
  breadcrumbLabels: string[];
  onDrillInto: (nodeId: string) => void;
  onNavigateToRoot: () => void;
  onNavigateToPathIndex: (index: number) => void;
  isSelectMode: boolean;
  onToggleSelectMode: () => void;
  /** Other people currently in this collaborative session - empty
   * outside of one. Used to render their live cursors and to show a
   * "someone else has this selected" indicator on nodes/edges. */
  peers: PresenceInfo[];
  /** Reports this person's own cursor position in flow coordinates
   * whenever it moves over the canvas, or null when it leaves the
   * canvas entirely - fed straight into presence broadcasting. Flow
   * coordinates (not screen pixels) because every peer's own viewport
   * (pan/zoom) is independent. */
  onCursorMove: (position: { x: number; y: number } | null) => void;
}

export function Canvas({
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
  onUpdateNode,
  onUpdateEdge,
  onReconnectEdge,
  onAddEdgeWaypoint,
  onMoveEdgeWaypoint,
  onEndEdgeGesture,
  onPreviewEdgeLabel,
  onRemoveEdgeWaypoint,
  onReparentNode,
  onAdoptIntoGroup,
  onZOrderCommand,
  presentation,
  previewFocus,
  focusNodeId,
  onFocusHandled,
  onPresentNext,
  onPresentPrev,
  onExitPresenting,
  breadcrumbLabels,
  onDrillInto,
  onNavigateToRoot,
  onNavigateToPathIndex,
  isSelectMode,
  onToggleSelectMode,
  peers,
  onCursorMove,
}: CanvasProps) {
  recordCanvasRender();
  const { screenToFlowPosition, getIntersectingNodes, fitView } =
    useReactFlow<Node<ArchNodeData>>();
  // Perf harness only (a no-op unless instrumented): lets scenarios frame the
  // nodes they are about to drag. Immediate rather than animated, and never
  // zoomed past 1, so a single node is shown at its natural size.
  useEffect(
    () =>
      registerPerfViewportFramer((nodeIds) => {
        void fitView({
          nodes: nodeIds.map((id) => ({ id })),
          padding: 0.25,
          maxZoom: 1,
          duration: 0,
        });
      }),
    [fitView],
  );
  const updateNodeInternals = useUpdateNodeInternals();
  const nodesRef = useRef(nodes);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  const measuredNodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newIds = nodes.filter((n) => !measuredNodeIdsRef.current.has(n.id)).map((n) => n.id);
    if (newIds.length === 0) return;
    for (const id of newIds) measuredNodeIdsRef.current.add(id);
    // Deferred one frame, not called synchronously - the point is
    // specifically to double-check the measurement AFTER React Flow's
    // own initial one has had a chance to run and the browser has had a
    // chance to finish laying out the node's actual content (text wrap
    // included), not to race it.
    const frame = requestAnimationFrame(() => {
      updateNodeInternals(newIds);
    });
    return () => cancelAnimationFrame(frame);
  }, [nodes, updateNodeInternals]);

  const isPresenting = presentation !== null;
  const { presentationFocus, activeFocus } = useCanvasFocusSets({
    presentation,
    previewFocus,
    focusNodeId,
  });

  /**
   * Which node (text annotation or shape) is being label-edited inline right now.
   */
  const [editingLabelNodeId, setEditingLabelNodeId] = useState<string | null>(null);

  const onChangeTextNode = useCallback(
    (nodeId: string, text: string) => onUpdateNode(nodeId, { label: text }),
    [onUpdateNode],
  );

  const onChangeCodeNode = useCallback(
    (nodeId: string, code: string) => onUpdateNode(nodeId, { codeContent: code }),
    [onUpdateNode],
  );

  const canvasContextValue = useMemo<CanvasContextValue>(
    () => ({
      isPresenting,
      onDrillInto,
      editingLabelNodeId,
      setEditingLabelNodeId,
      onChangeTextNode,
      onChangeCodeNode,
      onUpdateEdge,
      onAdoptIntoGroup,
      onAddEdgeWaypoint,
      onMoveEdgeWaypoint,
      onEndEdgeGesture,
      onPreviewEdgeLabel,
      onRemoveEdgeWaypoint,
    }),
    [
      isPresenting,
      onDrillInto,
      editingLabelNodeId,
      onChangeTextNode,
      onChangeCodeNode,
      onUpdateEdge,
      onAdoptIntoGroup,
      onAddEdgeWaypoint,
      onMoveEdgeWaypoint,
      onEndEdgeGesture,
      onPreviewEdgeLabel,
      onRemoveEdgeWaypoint,
    ],
  );

  const pathKey = breadcrumbLabels.join('>');

  const { handleConnectEnd, handleReconnectStart, handleReconnect, handleReconnectEnd } =
    useEdgeConnectionGestures({ screenToFlowPosition, onConnect, onReconnectEdge, nodesRef });

  const { onDragOver, onDrop, onCanvasDoubleClick } = useCanvasCreation({
    screenToFlowPosition,
    isPresenting,
    onAddNode,
    onAddGroup,
    onAddShape,
    onAddCode,
    onAddText,
    setEditingLabelNodeId,
  });

  const { alignmentGuides, onNodeDrag, onNodeDragStop } = useNodeDragInteractions({
    nodesRef,
    onNodesChange,
    getIntersectingNodes,
    onReparentNode,
    onAdoptIntoGroup,
  });

  const onNodeDoubleClick = useCallback<NodeMouseHandler<Node<ArchNodeData>>>(
    (_event, node) => {
      if (
        isPresenting ||
        node.type === 'group' ||
        node.type === 'text' ||
        node.type === 'shape' ||
        node.type === 'code'
      )
        return;
      onDrillInto(node.id);
    },
    [isPresenting, onDrillInto],
  );

  const {
    contextMenu,
    activeSubmenu,
    setActiveSubmenu,
    closeContextMenu,
    handleColorChange,
    handleIconChange,
    targetCurrentColor,
    targetDefaultColor,
    targetCurrentIcon,
    targetDefaultIcon,
    onNodeContextMenu,
    onSelectionContextMenu,
  } = useCanvasContextMenu({ isPresenting, nodes, nodesRef, onUpdateNode });

  const { displayNodes, displayEdges } = useCanvasFocusDisplay({
    nodes,
    edges,
    presentationFocus,
    previewFocus,
    activeFocus,
    pathKey,
    fitView,
    focusNodeId,
    onFocusHandled,
  });

  const levelLabel = breadcrumbLabels.length === 0 ? 'Root' : breadcrumbLabels.join(' › ');

  const docHover = useDiagramHoverDocumentation({
    nodes: displayNodes,
    edges: displayEdges,
    disabled: isPresenting,
  });
  // PERFORMANCE: the handlers below depend on closeDocumentation itself,
  // never on docHover. docHover is a new object on every render, and these
  // handlers go onto <ReactFlow> (onPaneClick, onMoveStart, onConnectStart,
  // onNodeDragStart), where a new identity re-renders every node. Written as
  // docHover.closeDocumentation(), react-hooks/exhaustive-deps asked for the
  // whole object - and following that advice is how a single-node drag went
  // from 23 node renders to 8,421 on techdebt/deconstruction. Destructuring
  // keeps the same function reference and leaves the rule nothing to ask for.
  const { closeDocumentation } = docHover;

  const handlePaneClick = useCallback(() => {
    closeContextMenu();
    closeDocumentation();
  }, [closeContextMenu, closeDocumentation]);

  const handleMoveStart = useCallback(() => {
    closeContextMenu();
    closeDocumentation();
  }, [closeContextMenu, closeDocumentation]);

  const handleConnectStartWithDoc = useCallback<OnConnectStart>(() => {
    closeContextMenu();
    closeDocumentation();
  }, [closeContextMenu, closeDocumentation]);

  const onNodeDragStart = useCallback(() => {
    closeContextMenu();
    closeDocumentation();
  }, [closeContextMenu, closeDocumentation]);

  const handlePaneMouseMove = useCallback(
    (event: ReactMouseEvent) => {
      onCursorMove(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [screenToFlowPosition, onCursorMove],
  );
  const handlePaneMouseLeave = useCallback(() => {
    onCursorMove(null);
  }, [onCursorMove]);

  return (
    <CanvasContext.Provider value={canvasContextValue}>
      <div
        className={`canvas${isSelectMode ? ' is-select-mode' : ''}`}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDoubleClick={onCanvasDoubleClick}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={CANVAS_NODE_TYPES}
          edgeTypes={CANVAS_EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnectStart={handleConnectStartWithDoc}
          onConnectEnd={handleConnectEnd}
          onReconnect={handleReconnect}
          onReconnectStart={handleReconnectStart}
          onReconnectEnd={handleReconnectEnd}
          connectionLineComponent={EdgeConnectionLine}
          // Clicking a border would otherwise arm React Flow's click-to-connect
          // mode, which has nothing to complete against now that no handle
          // is a drop target - connections are drag-only.
          connectOnClick={false}
          onNodeContextMenu={onNodeContextMenu}
          onSelectionContextMenu={onSelectionContextMenu}
          onNodeMouseEnter={docHover.handleNodeMouseEnter}
          onNodeMouseMove={docHover.handleNodeMouseMove}
          onNodeMouseLeave={docHover.handleNodeMouseLeave}
          onEdgeMouseEnter={docHover.handleEdgeMouseEnter}
          onEdgeMouseMove={docHover.handleEdgeMouseMove}
          onEdgeMouseLeave={docHover.handleEdgeMouseLeave}
          onNodeClick={docHover.handleNodeClick}
          onEdgeClick={docHover.handleEdgeClick}
          onPaneClick={handlePaneClick}
          onMoveStart={handleMoveStart}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneMouseMove={handlePaneMouseMove}
          onPaneMouseLeave={handlePaneMouseLeave}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          deleteKeyCode={null}
          nodesDraggable={!isPresenting}
          nodesConnectable={!isPresenting}
          edgesReconnectable={!isPresenting}
          // Raise the selected edge above the rest. React Flow renders endpoint
          // updaters for every edge, and where two edges meet at one handle the
          // later edge's updater covered the selected edge's - so dragging the
          // end of the edge you had selected picked up a different edge.
          elevateEdgesOnSelect
          elementsSelectable={!isPresenting}
          panOnDrag={!isSelectMode}
          selectionOnDrag={isSelectMode}
          selectionMode={SelectionMode.Partial}
          fitView
          proOptions={PRO_OPTIONS}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="rgba(255, 255, 255, 0.07)"
          />
          {!isPresenting && peers.length > 0 && (
            <ViewportPortal>
              {peers.flatMap((peer) =>
                displayNodes
                  .filter((n) => peer.selectedNodeIds.includes(n.id))
                  .map((n) => {
                    // Same geometry the alignment guides already use (see
                    // toAlignBox): ViewportPortal renders into the
                    // viewport's own coordinate space, so a node inside a
                    // group needs its ABSOLUTE position - n.position is
                    // relative to its parent - and a content-sized node
                    // has no explicit width/height at all, only a
                    // measured one, so `n.width ?? 0` collapsed those
                    // outlines to nothing.
                    const box = nodeToAlignBox(n, displayNodes);
                    return (
                      <div
                        key={`${peer.clientId}-${n.id}`}
                        className="peer-selection-outline"
                        style={{
                          left: box.x,
                          top: box.y,
                          width: box.width,
                          height: box.height,
                          borderColor: peer.color,
                        }}
                      >
                        <span
                          className="peer-selection-outline__label"
                          style={{ backgroundColor: peer.color }}
                        >
                          {peer.name}
                        </span>
                      </div>
                    );
                  }),
              )}
              {peers
                .filter((peer) => peer.cursor !== null)
                .map((peer) => (
                  <div
                    key={peer.clientId}
                    className="peer-cursor"
                    style={{ left: peer.cursor!.x, top: peer.cursor!.y }}
                  >
                    <MousePointer2 size={16} color={peer.color} fill={peer.color} />
                    <span className="peer-cursor__label" style={{ backgroundColor: peer.color }}>
                      {peer.name}
                    </span>
                  </div>
                ))}
            </ViewportPortal>
          )}
          {alignmentGuides.length > 0 && (
            <ViewportPortal>
              {alignmentGuides.map((guide, i) => (
                <div
                  key={i}
                  className="alignment-guide"
                  style={
                    guide.orientation === 'vertical'
                      ? {
                          left: guide.position,
                          top: guide.start,
                          width: 0,
                          height: guide.end - guide.start,
                        }
                      : {
                          top: guide.position,
                          left: guide.start,
                          width: guide.end - guide.start,
                          height: 0,
                        }
                  }
                />
              ))}
            </ViewportPortal>
          )}
          {!isPresenting && (
            <MiniMap
              pannable
              zoomable
              className="canvas__minimap"
              nodeColor="#3a3f4f"
              maskColor="rgba(15, 17, 23, 0.65)"
            />
          )}
          {!isPresenting && (
            <Controls>
              <ControlButton
                onClick={onToggleSelectMode}
                className={isSelectMode ? 'is-active' : undefined}
                title={
                  isSelectMode
                    ? 'Select mode - drag to marquee-select. Click to switch back to pan.'
                    : 'Pan mode - drag to move the canvas. Click to switch to select mode.'
                }
              >
                <MousePointer2 size={13} />
              </ControlButton>
            </Controls>
          )}
          {!isPresenting && (
            <Breadcrumb
              labels={breadcrumbLabels}
              onNavigateToRoot={onNavigateToRoot}
              onNavigateToIndex={onNavigateToPathIndex}
            />
          )}
          {presentation && (
            <PresentationOverlay
              scenario={presentation.scenario}
              step={presentation.step}
              stepIndex={presentation.stepIndex}
              levelLabel={levelLabel}
              onNext={onPresentNext}
              onPrev={onPresentPrev}
              onExit={onExitPresenting}
            />
          )}
        </ReactFlow>

        {contextMenu && (
          <CanvasContextMenu
            contextMenu={contextMenu}
            activeSubmenu={activeSubmenu}
            setActiveSubmenu={setActiveSubmenu}
            closeContextMenu={closeContextMenu}
            onZOrderCommand={onZOrderCommand}
            targetCurrentColor={targetCurrentColor}
            targetDefaultColor={targetDefaultColor}
            handleColorChange={handleColorChange}
            targetCurrentIcon={targetCurrentIcon}
            targetDefaultIcon={targetDefaultIcon}
            handleIconChange={handleIconChange}
          />
        )}

        <DocumentationPopup
          documentation={docHover.documentation}
          title={docHover.title}
          subtitle={docHover.subtitle}
          open={docHover.isOpen}
          anchor={docHover.anchor}
          onClose={docHover.closeDocumentation}
          onMouseEnter={docHover.handlePopupMouseEnter}
          onMouseLeave={docHover.handlePopupMouseLeave}
        />
      </div>
    </CanvasContext.Provider>
  );
}
