import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  MiniMap,
  MarkerType,
  SelectionMode,
  ViewportPortal,
  useReactFlow,
  useStoreApi,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type OnConnectStart,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import { MousePointer2 } from 'lucide-react';
import { TypedNode } from './nodes/TypedNode';
import { TypedEdge } from './edges/TypedEdge';
import { GroupNode } from './nodes/GroupNode';
import { TextNode } from './nodes/TextNode';
import { ShapeNode } from './nodes/ShapeNode';
import { CodeNode } from './nodes/CodeNode';
import { PresentationOverlay } from './PresentationOverlay';
import { Breadcrumb } from './Breadcrumb';
import { DocumentationPopup } from '../documentation/DocumentationPopup';
import { useDiagramHoverDocumentation } from '../documentation/useDiagramHoverDocumentation';
import type { ZOrderCommand } from '../../domain/canvas/zOrder';
import type {
  ArchNodeData,
  ArchEdgeData,
  ArchEdgeDataPatch,
  EdgeWaypoint,
  Scenario,
  ScenarioStep,
} from '../../domain/canvas/types';
import type { LabelPlacement } from '../../domain/canvas/gestureGeometry';
import type { EdgeEndpoints } from '../../domain/canvas/edgeReconnect';
import { EdgeConnectionLine } from './edges/EdgeConnectionLine';
import type { PresenceInfo } from '../../collab/sync/session';
import { CanvasContext, type CanvasContextValue } from './CanvasContext';
import { recordCanvasRender, registerPerfViewportFramer } from '../../perf/instrumentation';
import { CanvasAlignmentOverlay } from './CanvasAlignmentOverlay';
import { CanvasContextMenuPortal } from './CanvasContextMenuPortal';
import { useCanvasInteractions } from './hooks/useCanvasInteractions';

/**
 * Memoised, because React Flow renders a custom node or edge whenever it
 * re-adopts it - including when only its measured size was handed back, which
 * changes nothing the component draws. Unmemoised, every node rendered twice on
 * drop, twice on drag end, and on every layout sync.
 */
const CANVAS_NODE_TYPES: NodeTypes = {
  typed: memo(TypedNode),
  group: memo(GroupNode),
  text: memo(TextNode),
  shape: memo(ShapeNode),
  code: memo(CodeNode),
};

const CANVAS_EDGE_TYPES: EdgeTypes = {
  typed: memo(TypedEdge),
};

/**
 * Default opacity applied to nodes and edges that are NOT part of the active
 * presentation step. Keeps context visible in the background while making the
 * highlighted path pop.
 */
const DIMMED_NODE_OPACITY = 0.12;
const DIMMED_EDGE_OPACITY = 0.08;

const PRO_OPTIONS = { hideAttribution: true };

interface FocusSet {
  nodeIds: string[];
  edgeIds: string[];
}

interface CanvasProps {
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
  onNodesChange: OnNodesChange<Node<ArchNodeData>>;
  onEdgesChange: OnEdgesChange<Edge<ArchEdgeData>>;
  onConnect: OnConnect;
  onAddNode: (typeId: string, position: { x: number; y: number }) => void;
  onAddGroup: (typeId: string, position: { x: number; y: number }) => void;
  onAddText: (position: { x: number; y: number }) => string;
  onAddShape: (typeId: string, position: { x: number; y: number }) => void;
  onAddCode: (position: { x: number; y: number }) => string;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  onUpdateEdge: (id: string, patch: ArchEdgeDataPatch) => void;
  /** Dropping an edge's endpoint onto a new node/side. Passed down
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
  onPreviewEdgeLabel?: (edgeId: string, placement: LabelPlacement) => void;
  onRemoveEdgeWaypoint?: (edgeId: string, waypointId: string) => void;
  /** Moving a node into or out of a boundary. Group nodes nest, so
   * targetGroupId is the INNERMOST group overlapping the drop point, or
   * null if the drop landed on the root canvas. */
  onReparentNode: (nodeId: string, targetGroupId: string | null) => void;
  /** Adopting one or more nodes into a newly created or dragged boundary.
   * Keeps their absolute positions visually identical across the reparent. */
  onAdoptIntoGroup: (
    groupId: string,
    nodeIds: string[],
    groupPosition?: { x: number; y: number },
  ) => void;
  onZOrderCommand: (command: ZOrderCommand, targetIds: string[]) => void;
  presentation: {
    scenario: Scenario;
    step: ScenarioStep;
    stepIndex: number;
  } | null;
  /** Live focus set from a scenario step currently being edited in
   * ScenarioPanel, without entering full Presentation Mode. Highlights
   * the focused nodes/edges so you can see what the step covers while
   * building it. */
  previewFocus?: { nodeIds: string[]; edgeIds: string[] } | null;
  /** When set, the canvas smoothly pans and zooms to frame this node,
   * then clears the focus via onFocusHandled so the user is free to
   * navigate elsewhere. Driven by clicking a canvas-node link inside
   * RequirementsView. */
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
  onCommitGesture?: () => void;
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
  onCommitGesture,
}: CanvasProps) {
  recordCanvasRender();
  const { screenToFlowPosition, getIntersectingNodes, fitView } =
    useReactFlow<Node<ArchNodeData>>();

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

  const nodesRef = useRef(nodes);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const isPresenting = presentation !== null;
  const presentationFocus: FocusSet | null = useMemo(
    () =>
      presentation
        ? { nodeIds: presentation.step.focusNodeIds, edgeIds: presentation.step.focusEdgeIds }
        : null,
    [presentation],
  );

  const navigationFocus: FocusSet | null = useMemo(
    () => (focusNodeId ? { nodeIds: [focusNodeId], edgeIds: [] } : null),
    [focusNodeId],
  );
  const activeFocus: FocusSet | null = presentationFocus ?? previewFocus ?? navigationFocus;

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
  const reactFlowStore = useStoreApi<Node<ArchNodeData>, Edge<ArchEdgeData>>();

  const {
    alignmentGuides,
    handleConnectEnd,
    handleReconnectStart,
    handleReconnect,
    handleReconnectEnd,
    onDragOver,
    onDrop,
    onCanvasDoubleClick,
    onNodeDrag,
    onNodeDragStop,
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
  } = useCanvasInteractions({
    nodes,
    nodesRef,
    onNodesChange,
    onConnect,
    onReconnectEdge,
    onAddNode,
    onAddGroup,
    onAddShape,
    onAddCode,
    onAddText,
    onUpdateNode,
    onReparentNode,
    onAdoptIntoGroup,
    isPresenting,
    setEditingLabelNodeId,
    reactFlowStore,
    screenToFlowPosition,
    getIntersectingNodes,
    onCommitGesture,
  });

  const displayNodes = useMemo(() => {
    if (presentationFocus) {
      const focusIds = new Set(presentationFocus.nodeIds);
      return nodes.map((n) => ({
        ...n,
        className: focusIds.has(n.id) ? 'is-presentation-focus' : undefined,
        style: { ...n.style, opacity: focusIds.has(n.id) ? 1 : DIMMED_NODE_OPACITY },
      }));
    }
    if (previewFocus) {
      const memberIds = new Set(previewFocus.nodeIds);
      return nodes.map((n) => {
        if (memberIds.has(n.id)) return { ...n, className: 'is-step-member' };
        if (n.selected) return { ...n, className: 'is-step-candidate' };
        return n;
      });
    }
    return nodes;
  }, [nodes, presentationFocus, previewFocus]);

  const displayEdges = useMemo(() => {
    if (presentationFocus) {
      const focusIds = new Set(presentationFocus.edgeIds);
      return edges.map((e) => ({
        ...e,
        animated: focusIds.has(e.id),
        style: { ...e.style, opacity: focusIds.has(e.id) ? 1 : DIMMED_EDGE_OPACITY },
      }));
    }
    if (previewFocus) {
      const memberIds = new Set(previewFocus.edgeIds);
      return edges.map((e): Edge<ArchEdgeData> => {
        if (!e.data) return e;
        return { ...e, data: { ...e.data, isStepMember: memberIds.has(e.id) } };
      });
    }
    return edges;
  }, [edges, presentationFocus, previewFocus]);

  const focusKey = activeFocus ? activeFocus.nodeIds.join(',') : null;
  useEffect(() => {
    if (!activeFocus || activeFocus.nodeIds.length === 0) return;
    void fitView({
      nodes: activeFocus.nodeIds.map((id) => ({ id })),
      padding: 0.35,
      duration: 450,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, fitView]);

  useEffect(() => {
    if (activeFocus) return;
    void fitView({ padding: 0.2, duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey, fitView]);

  const onFocusHandledRef = useRef(onFocusHandled);
  useLayoutEffect(() => {
    onFocusHandledRef.current = onFocusHandled;
  }, [onFocusHandled]);

  useEffect(() => {
    if (!focusNodeId) return;
    const frame = requestAnimationFrame(() => onFocusHandledRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [focusNodeId]);

  const levelLabel = breadcrumbLabels.length === 0 ? 'Root' : breadcrumbLabels.join(' › ');

  const docHover = useDiagramHoverDocumentation({
    nodes: displayNodes,
    edges: displayEdges,
    disabled: isPresenting,
  });

  const handlePaneClick = useCallback(() => {
    closeContextMenu();
    docHover.closeDocumentation();
  }, [closeContextMenu, docHover]);

  const handleMoveStart = useCallback(() => {
    closeContextMenu();
    docHover.closeDocumentation();
  }, [closeContextMenu, docHover]);

  const handleConnectStartWithDoc = useCallback<OnConnectStart>(() => {
    closeContextMenu();
    docHover.closeDocumentation();
  }, [closeContextMenu, docHover]);

  const onNodeDragStart = useCallback(() => {
    closeContextMenu();
    docHover.closeDocumentation();
  }, [closeContextMenu, docHover]);

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
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          panOnDrag={!isSelectMode}
          selectionMode={SelectionMode.Partial}
          selectionOnDrag={isSelectMode}
          deleteKeyCode={null}
          nodesDraggable={!isPresenting}
          nodesConnectable={!isPresenting}
          edgesReconnectable={!isPresenting}
          elevateEdgesOnSelect
          elementsSelectable={!isPresenting}
          panOnScroll
          zoomOnPinch
          zoomOnScroll
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={PRO_OPTIONS}
          defaultEdgeOptions={{
            type: 'typed',
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          }}
          onMoveStart={handleMoveStart}
          onPaneMouseMove={handlePaneMouseMove}
          onPaneMouseLeave={handlePaneMouseLeave}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.5}
            color="#2a2e3d"
            style={{ backgroundColor: '#0f1117' }}
          />
          {peers.length > 0 && (
            <ViewportPortal>
              {peers.flatMap((peer) =>
                peer.selectedNodeIds
                  .map((id) => nodes.find((n) => n.id === id))
                  .filter((node): node is Node<ArchNodeData> => Boolean(node))
                  .map((node) => {
                    const width = node.measured?.width ?? 200;
                    return (
                      <div
                        key={`${peer.clientId}-${node.id}`}
                        className="peer-selection-halo"
                        style={{
                          left: node.position.x - 4,
                          top: node.position.y - 4,
                          width: width + 8,
                          height: (node.measured?.height ?? 100) + 8,
                          borderColor: peer.color,
                        }}
                      >
                        <span
                          className="peer-selection-halo__name"
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
          <CanvasAlignmentOverlay alignmentGuides={alignmentGuides} />
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

        <CanvasContextMenuPortal
          contextMenu={contextMenu}
          activeSubmenu={activeSubmenu}
          setActiveSubmenu={setActiveSubmenu}
          onZOrderCommand={onZOrderCommand}
          closeContextMenu={closeContextMenu}
          targetCurrentColor={targetCurrentColor}
          targetDefaultColor={targetDefaultColor}
          handleColorChange={handleColorChange}
          targetCurrentIcon={targetCurrentIcon}
          targetDefaultIcon={targetDefaultIcon}
          handleIconChange={handleIconChange}
        />

        <DocumentationPopup
          documentation={docHover.documentation}
          title={docHover.title}
          subtitle={docHover.subtitle}
          open={docHover.isOpen}
          anchor={docHover.anchor}
          onClose={docHover.closeDocumentation}
        />
      </div>
    </CanvasContext.Provider>
  );
}
