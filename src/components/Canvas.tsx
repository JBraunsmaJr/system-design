import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  useUpdateNodeInternals,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type OnConnectStart,
  type OnNodeDrag,
  type OnReconnect,
  type HandleType,
  type NodeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import { MousePointer2, BringToFront, SendToBack, ChevronUp, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { TypedNode } from "./nodes/TypedNode";
import { TypedEdge } from "./edges/TypedEdge";
import { GroupNode } from "./nodes/GroupNode";
import { TextNode } from "./nodes/TextNode";
import { ShapeNode } from "./nodes/ShapeNode";
import { CodeNode } from "./nodes/CodeNode";
import { PresentationOverlay } from "./PresentationOverlay";
import { Breadcrumb } from "./Breadcrumb";
import { DocumentationPopup } from "./documentation/DocumentationPopup";
import { useDiagramHoverDocumentation } from "./documentation/useDiagramHoverDocumentation";
import { NODE_TYPES } from "../domain/nodeRegistry";
import { GROUP_TYPES } from "../domain/groupRegistry";
import { SHAPE_TYPES, globalShapeRegistry } from "../domain/shapeRegistry";
import { computeAlignment, type AlignBox, type AlignmentGuide } from "../domain/alignmentGuides";
import type { ZOrderCommand } from "../domain/zOrder";
import { toAbsolutePosition } from "../domain/graphUtils";
import { DRAG_MIME_TYPE, GROUP_DRAG_MIME_TYPE, TEXT_DRAG_MIME_TYPE, SHAPE_DRAG_MIME_TYPE, CODE_DRAG_MIME_TYPE } from "./Palette";
import type { ArchNodeData, ArchEdgeData, ArchEdgeDataPatch, EdgeWaypoint, Scenario, ScenarioStep } from "../domain/types";
import {
  normalizeReconnection,
  validateReconnection,
  isSameEndpoints,
  type EdgeEnd,
  type EdgeEndpoints,
} from "../domain/edgeReconnect";
import type { PresenceInfo } from "../collab/session";
import { CanvasContext, type CanvasContextValue } from "./CanvasContext";
import { recordCanvasRender } from "../perf/instrumentation";

const CANVAS_NODE_TYPES: NodeTypes = {
  typed: TypedNode,
  group: GroupNode,
  shape: ShapeNode,
  text: TextNode,
  code: CodeNode,
};

const CANVAS_EDGE_TYPES: EdgeTypes = {
  typed: TypedEdge,
};

const DEFAULT_EDGE_OPTIONS = {
  type: "typed",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#98a2b3" },
  markerStart: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#98a2b3" },
};

const PRO_OPTIONS = { hideAttribution: true };

function nodeToAlignBox(n: Node<ArchNodeData>, allNodes: Node<ArchNodeData>[]): AlignBox {
  const absolute = toAbsolutePosition(n, allNodes, n.parentId);
  return {
    id: n.id,
    x: absolute.x,
    y: absolute.y,
    width: n.width ?? n.measured?.width ?? 0,
    height: n.height ?? n.measured?.height ?? 0,
  };
}

// Fixed because the menu always holds the same four items - see
// openContextMenu's clamping.
const CONTEXT_MENU_WIDTH = 184;
const CONTEXT_MENU_HEIGHT = 140;

const DIMMED_NODE_OPACITY = 0.15;
const DIMMED_EDGE_OPACITY = 0.12;

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

interface CanvasProps {
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
  onMoveEdgeWaypoint: (edgeId: string, waypointId: string, position: { x: number; y: number }) => void;
  onRemoveEdgeWaypoint: (edgeId: string, waypointId: string) => void;
  onReparentNode: (nodeId: string, newParentId: string | null) => void;
  onAdoptIntoGroup: (groupId: string, nodeIds: string[], groupPosition?: { x: number; y: number }) => void;
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
  const { screenToFlowPosition, getIntersectingNodes, fitView } = useReactFlow<Node<ArchNodeData>>();
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
  // Full presentation always wins over a step preview if somehow both were
  // active; in practice previewFocus is only ever set while NOT presenting
  // (see App.tsx), so this is mostly a defensive fallback.
  const presentationFocus: FocusSet | null = useMemo(
    () =>
      presentation ? { nodeIds: presentation.step.focusNodeIds, edgeIds: presentation.step.focusEdgeIds } : null,
    [presentation]
  );
  /**
   * Deliberately kept separate from presentationFocus, not merged into one
   * "activeFocus" - the two need different visual treatments. Full
   * Presentation Mode dims everything else for audience-facing drama; the
   * Scenario panel's step-editing preview instead just highlights members
   * while leaving everything ELSE at full visibility/opacity, since while
   * you're actively adding/removing things from a step you need to clearly see
   * (and click) the candidates, not have them all dimmed into near invisibility.
   * Camera auto-framing (below) still treats both the same, since "zoom to
   * what's focused" is equally useful for either
   */
  /** A single-node focus for "jump to this node" navigation (see
   * focusNodeId's own doc comment). Deliberately kept out of the
   * presentationFocus/previewFocus dimming logic below (neither of those
   * two derive from this) - navigating here should just move the camera,
   * not dim the rest of the canvas the way an active presentation does. */
  const navigationFocus: FocusSet | null = useMemo(
    () => (focusNodeId ? { nodeIds: [focusNodeId], edgeIds: [] } : null),
    [focusNodeId]
  );
  const activeFocus: FocusSet | null = presentationFocus ?? previewFocus ?? navigationFocus;

  /**
   * Which node (text annotation or shape) is being label-edited inline right now.
   */
  const [editingLabelNodeId, setEditingLabelNodeId] = useState<string | null>(null);

  // Alignment guides (draw.io/Excalidraw-style "smart guides") - visible
  // only while actively dragging a node, cleared as soon as the drag ends.
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);

  const onChangeTextNode = useCallback(
    (nodeId: string, text: string) => onUpdateNode(nodeId, { label: text }),
    [onUpdateNode]
  );

  const onChangeCodeNode = useCallback(
    (nodeId: string, code: string) => onUpdateNode(nodeId, { codeContent: code }),
    [onUpdateNode]
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
      onRemoveEdgeWaypoint,
    ]
  );

  const pathKey = breadcrumbLabels.join(">");

  // Each node has both a source-type and a target-type handle stacked at
  // every position (see TypedNode.tsx), so a connection can be dragged
  // starting from either end. React Flow decides a resulting connection's
  // source/target based on which HANDLE TYPE is on each side, not which one
  // the drag actually started from - with overlapping handles at every
  // position that can silently produce an edge running opposite to the
  // direction you actually dragged. This tracks the node the drag genuinely
  // started from and, if React Flow's own result doesn't match it, swaps
  // source/target (and their handles) back before the edge is created.
  const connectStartNodeId = useRef<string | null>(null);

  const onConnectStart = useCallback<OnConnectStart>((_event, { nodeId }) => {
    connectStartNodeId.current = nodeId;
  }, []);

  const handleConnect = useCallback<OnConnect>(
    (connection: Connection) => {
      const startId = connectStartNodeId.current;
      connectStartNodeId.current = null;
      if (startId && startId === connection.target && startId !== connection.source) {
        onConnect({
          source: connection.target,
          sourceHandle: connection.targetHandle,
          target: connection.source,
          targetHandle: connection.sourceHandle,
        });
        return;
      }
      onConnect(connection);
    },
    [onConnect]
  );

  /**
   * Which END of the edge is being dragged. React Flow reports it to
   * onReconnectStart and then doesn't mention it again, but onReconnect
   * can't be interpreted without it - see handleReconnect. Same ref
   * pattern, and for much the same reason, as connectStartNodeId above.
   */
  const reconnectEndRef = useRef<EdgeEnd | null>(null);

  const handleReconnectStart = useCallback(
    (_event: ReactMouseEvent, _edge: Edge<ArchEdgeData>, handleType: HandleType) => {
      reconnectEndRef.current = handleType === "source" ? "source" : "target";
    },
    []
  );

  /**
   * Endpoint reconnection, with the same correction edge CREATION needs
   * just above.
   *
   * Every node stacks a source-type and a target-type handle at each
   * position, so React Flow labels the two ends of the resulting
   * Connection from the handle types it landed on rather than from which
   * end was dragged - which means taking it at face value can silently
   * reverse the edge as a side effect of moving one of its ends.
   * normalizeReconnection pins the end that WASN'T dragged to what it
   * already was and reads the other end off the Connection.
   *
   * Two guards before anything is written. A drag released back where it
   * started still fires this, and writing that would sync a no-op to
   * every peer and put an entry in undo history for a gesture that
   * changed nothing. And both ends have to be nodes at this level of the
   * sub-diagram tree - React Flow only renders one level so a drag
   * shouldn't be able to reach off it, but an edge that did would be
   * invisible from every level rather than visibly wrong.
   */
  const handleReconnect = useCallback<OnReconnect<Edge<ArchEdgeData>>>(
    (oldEdge, connection) => {
      const draggedEnd = reconnectEndRef.current ?? "target";
      reconnectEndRef.current = null;

      const next = normalizeReconnection(oldEdge, connection, draggedEnd);
      if (isSameEndpoints(oldEdge, next)) return;

      const check = validateReconnection(next, new Set(nodesRef.current.map((n) => n.id)));
      if (!check.ok) return;

      onReconnectEdge(oldEdge.id, next);
    },
    [onReconnectEdge]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      const nodeTypeId = event.dataTransfer.getData(DRAG_MIME_TYPE);
      if (nodeTypeId && NODE_TYPES.some((n) => n.id === nodeTypeId)) {
        onAddNode(nodeTypeId, position);
        return;
      }

      const groupTypeId = event.dataTransfer.getData(GROUP_DRAG_MIME_TYPE);
      if (groupTypeId && GROUP_TYPES.some((g) => g.id === groupTypeId)) {
        onAddGroup(groupTypeId, position);
        return;
      }

      const shapeTypeId = event.dataTransfer.getData(SHAPE_DRAG_MIME_TYPE);
      if (shapeTypeId && (SHAPE_TYPES.some((s) => s.id === shapeTypeId) || globalShapeRegistry.getShape(shapeTypeId))) {
        onAddShape(shapeTypeId, position);
        return;
      }

      if (event.dataTransfer.getData(CODE_DRAG_MIME_TYPE)) {
        setEditingLabelNodeId(onAddCode(position));
        return;
      }

      if (event.dataTransfer.getData(TEXT_DRAG_MIME_TYPE)) {
        setEditingLabelNodeId(onAddText(position));
      }
    },
    [screenToFlowPosition, onAddNode, onAddGroup, onAddShape, onAddCode, onAddText]
  );

  // Double-clicking truly empty canvas creates a text annotation right
  // there and drops straight into editing it - checking that the event
  // target is the pane element itself (not bubbled from a node, edge, or
  // overlay control) is what keeps this from firing on top of, say,
  // double-clicking a node to drill into it.
  const onCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isPresenting) return;
      const target = event.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setEditingLabelNodeId(onAddText(position));
    },
    [isPresenting, screenToFlowPosition, onAddText]
  );

  const getAlignmentCandidates = useCallback(
    (draggedNode: Node<ArchNodeData>) =>
      nodesRef.current.filter((n) => {
        if (n.id === draggedNode.id) return false;
        return !(draggedNode.type === "group" && n.parentId === draggedNode.id);
      }),
    []
  );

  const onNodeDrag = useCallback<OnNodeDrag<Node<ArchNodeData>>>(
    (_event, draggedNode) => {
      const boxes = [draggedNode, ...getAlignmentCandidates(draggedNode)].map((n) =>
        nodeToAlignBox(n, nodesRef.current)
      );
      const movingBox = boxes.find((b) => b.id === draggedNode.id);
      if (!movingBox) return;
      const { guides } = computeAlignment(movingBox, boxes);
      setAlignmentGuides(guides);
    },
    [getAlignmentCandidates]
  );

  // Two symmetric cases here:
  //  - dragging a regular node so it overlaps a boundary makes it a child of
  //    that boundary (moves with it from then on)
  //  - dragging a *boundary* over existing nodes adopts whichever nodes now
  //    fall fully inside it, rather than requiring each one to be dragged in
  //    individually. Full containment (not just a corner clipping) is
  //    required for the boundary-drag case, since you're enclosing them.
  // See App.tsx's onReparentNode/onAdoptIntoGroup for the position math.
  const onNodeDragStop = useCallback<OnNodeDrag<Node<ArchNodeData>>>(
    (_event, draggedNode) => {
      setAlignmentGuides([]);

      const boxes = [draggedNode, ...getAlignmentCandidates(draggedNode)].map((n) =>
        nodeToAlignBox(n, nodesRef.current)
      );
      const movingBox = boxes.find((b) => b.id === draggedNode.id);
      if (movingBox) {
        const { snapDx, snapDy } = computeAlignment(movingBox, boxes);
        if (snapDx !== 0 || snapDy !== 0) {
          onNodesChange([
            {
              id: draggedNode.id,
              type: "position",
              position: { x: draggedNode.position.x + snapDx, y: draggedNode.position.y + snapDy },
            },
          ]);
        }
      }

      if (draggedNode.type === "group") {
        const contained = getIntersectingNodes(draggedNode, false).filter(
          (n) => n.type !== "group" && n.parentId !== draggedNode.id
        );
        if (contained.length > 0) {
          onAdoptIntoGroup(
            draggedNode.id,
            contained.map((n) => n.id)
          );
        }
        return;
      }
      const intersectingGroup = getIntersectingNodes(draggedNode).find((n) => n.type === "group");
      onReparentNode(draggedNode.id, intersectingGroup ? intersectingGroup.id : null);
    },
    [getAlignmentCandidates, onNodesChange, getIntersectingNodes, onReparentNode, onAdoptIntoGroup]
  );

  const onNodeDoubleClick = useCallback<NodeMouseHandler<Node<ArchNodeData>>>(
    (_event, node) => {
      if (
        isPresenting ||
        node.type === "group" ||
        node.type === "text" ||
        node.type === "shape" ||
        node.type === "code"
      )
        return;
      onDrillInto(node.id);
    },
    [isPresenting, onDrillInto]
  );

  // Dims everything except the active focus set (full presentation step, or
  // a lightweight step preview from ScenarioPanel) and adds a glow class to
  // focused elements so the highlight reads clearly, not just as "slightly
  // less dim." Group nodes and text annotations can be focus targets too -
  // they're ordinary node ids underneath.
  /**
   * Right-click menu state. Position is in VIEWPORT coordinates (the menu
   * is portaled to document.body and fixed-positioned), not flow
   * coordinates - it should stay under the cursor, not pinned to a spot
   * on the canvas that moves when you pan.
   */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetIds: string[] } | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent, nodeId: string | null) => {
      if (isPresenting) return; // the locked slideshow view has nothing to arrange
      event.preventDefault();

      const selectedIds = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
      // Right-clicking inside a multi-selection acts on the whole
      // selection; right-clicking a node outside it acts on just that
      // node, which is what every other editor does and avoids silently
      // reordering something off-screen.
      const targetIds =
        nodeId === null ? selectedIds : selectedIds.includes(nodeId) ? selectedIds : [nodeId];
      if (targetIds.length === 0) return;

      // Clamped so the menu never opens partly off-screen. The size is
      // fixed (four items), so constants are enough here and avoid a
      // measure-then-reposition pass.
      const left = Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8);
      const top = Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8);
      setContextMenu({ x: Math.max(8, left), y: Math.max(8, top), targetIds });
    },
    [isPresenting]
  );

  /**
   * Both handlers are memoized rather than written inline on the
   * ReactFlow element, because React Flow hands onNodeContextMenu down
   * to EVERY NodeWrapper (which is memo'd) and puts onMoveStart in its
   * own store. An inline arrow is a new identity on every render, so it
   * would break the memo on every node at once and push a store update
   * each render - turning any Canvas re-render into a re-render of the
   * whole graph.
   */
  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node<ArchNodeData>) => openContextMenu(event, node.id),
    [openContextMenu]
  );
  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent) => openContextMenu(event, null),
    [openContextMenu]
  );

  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    // Any click anywhere dismisses, including one that lands on the menu
    // itself - the item's own onClick has already run by then.
    document.addEventListener("click", closeContextMenu);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", closeContextMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  const displayNodes = useMemo(() => {
    // zIndex is attached upstream, inside App's existing nodes map, so
    // there's no second pass over the array here - and the common case
    // returns the identical array it was given, which is what lets React
    // Flow skip re-adopting every node.
    if (presentationFocus) {
      const focusIds = new Set(presentationFocus.nodeIds);
      return nodes.map((n) => ({
        ...n,
        className: focusIds.has(n.id) ? "is-presentation-focus" : undefined,
        style: { ...n.style, opacity: focusIds.has(n.id) ? 1 : DIMMED_NODE_OPACITY },
      }));
    }
    if (previewFocus) {
      const memberIds = new Set(previewFocus.nodeIds);
      return nodes.map((n) => {
        if (memberIds.has(n.id)) return { ...n, className: "is-step-member" };
        // Selected while a step is being edited, but not (yet) part of it -
        // a distinct highlight from is-step-member, signaling "you could
        // add this" rather than "this is already included".
        if (n.selected) return { ...n, className: "is-step-candidate" };
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
      /**
       * TypedEdge reads data.isStepMember itself (see its comment on
       * ArcheEdgeData) rather than a className, since React Flow doesn't pass
       * an edge's className through to custom edge components the way it does
       * for nodes. Setting it explicitly to false (not leaving it undefined)
       * for non-members - rather than only setting it for members - is what lets
       * TypedEdge tell a step preview is active, but this specific
       * edge isn't part of it.
       */
      const memberIds = new Set(previewFocus.edgeIds);
      return edges.map((e): Edge<ArchEdgeData> => {
        if (!e.data) return e;
        return { ...e, data: { ...e.data, isStepMember: memberIds.has(e.id) } };
      });
    }
    return edges;
  }, [edges, presentationFocus, previewFocus]);

  // Auto-frame the camera on the active focus set's nodes. Keyed off a
  // derived string (not the object itself) so this only re-fits when the
  // actual focused ids change, not on every render. Clearing focus doesn't
  // trigger a re-fit - only a newly (re)activated focus does.
  const focusKey = activeFocus ? activeFocus.nodeIds.join(",") : null;
  useEffect(() => {
    if (!activeFocus || activeFocus.nodeIds.length === 0) return;
    fitView({ nodes: activeFocus.nodeIds.map((id) => ({ id })), padding: 0.35, duration: 450 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, [focusKey, fitView]);

  // The current level's contents change (drilling in/out swaps to a
  // completely different set of nodes), so re-frame the camera whenever the
  // breadcrumb path changes - UNLESS there's an active focus (presenting or
  // previewing), in which case the focus-based effect above already frames
  // the right thing; without this guard, a scenario step that both changes
  // level AND focuses specific elements would fire two competing fitView
  // calls back to back.
  useEffect(() => {
    if (activeFocus) return;
    fitView({ padding: 0.2, duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, [pathKey, fitView]);

  // Clears the one-shot "jump to this node" request once it's been
  // consumed, so navigating to the same node again later still fires -
  // same requestAnimationFrame-deferred pattern as RequirementsView's
  // focusItemId handling (waits a frame so this always runs after the
  // fitView effects above, which need the just-changed path's nodes to
  // already be rendered). Deliberately a separate effect, not folded into
  // the fitView effects above, so it can't change their existing,
  // already-correct coordination logic.
  const onFocusHandledRef = useRef(onFocusHandled);
  useLayoutEffect(() => {
    onFocusHandledRef.current = onFocusHandled;
  }, [onFocusHandled]);

  useEffect(() => {
    if (!focusNodeId) return;
    const frame = requestAnimationFrame(() => onFocusHandledRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [focusNodeId]);

  const levelLabel = breadcrumbLabels.length === 0 ? "Root" : breadcrumbLabels.join(" › ");

  const docHover = useDiagramHoverDocumentation({
    nodes: displayNodes,
    edges: displayEdges,
    disabled: isPresenting,
  });

  const handlePaneClick = useCallback(() => {
    closeContextMenu();
    docHover.closeDocumentation();
  }, [closeContextMenu, docHover.closeDocumentation]);

  const handleMoveStart = useCallback(() => {
    closeContextMenu();
    docHover.closeDocumentation();
  }, [closeContextMenu, docHover.closeDocumentation]);

  const handleConnectStartWithDoc = useCallback<OnConnectStart>(
    (event, params) => {
      closeContextMenu();
      docHover.closeDocumentation();
      onConnectStart(event, params);
    },
    [closeContextMenu, docHover.closeDocumentation, onConnectStart]
  );

  const onNodeDragStart = useCallback(() => {
    closeContextMenu();
    docHover.closeDocumentation();
  }, [closeContextMenu, docHover.closeDocumentation]);

  const handlePaneMouseMove = useCallback(
    (event: ReactMouseEvent) => {
      onCursorMove(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [screenToFlowPosition, onCursorMove]
  );
  const handlePaneMouseLeave = useCallback(() => {
    onCursorMove(null);
  }, [onCursorMove]);

  return (
    <CanvasContext.Provider value={canvasContextValue}>
      <div
        className={`canvas${isSelectMode ? " is-select-mode" : ""}`}
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
          onConnect={handleConnect}
          onConnectStart={handleConnectStartWithDoc}
          onReconnect={handleReconnect}
          onReconnectStart={handleReconnectStart}
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
          elementsSelectable={!isPresenting}
          panOnDrag={!isSelectMode}
          selectionOnDrag={isSelectMode}
          selectionMode={SelectionMode.Partial}
          fitView
          proOptions={PRO_OPTIONS}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255, 255, 255, 0.07)" />
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
                        <span className="peer-selection-outline__label" style={{ backgroundColor: peer.color }}>
                          {peer.name}
                        </span>
                      </div>
                    );
                  })
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
                    guide.orientation === "vertical"
                      ? { left: guide.position, top: guide.start, width: 0, height: guide.end - guide.start }
                      : { top: guide.position, left: guide.start, width: guide.end - guide.start, height: 0 }
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
                className={isSelectMode ? "is-active" : undefined}
                title={
                  isSelectMode
                    ? "Select mode - drag to marquee-select. Click to switch back to pan."
                    : "Pan mode - drag to move the canvas. Click to switch to select mode."
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

        {/* Portaled to document.body and fixed-positioned for the same
            reason CollabPanel's dropdown is: React Flow's viewport is a
            transformed, clipping ancestor, and a menu rendered inside it
            would be scaled with the zoom and clipped at the pane edge. */}
        {contextMenu &&
          createPortal(
            <div
              className="canvas-context-menu"
              style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, width: CONTEXT_MENU_WIDTH }}
              role="menu"
            >
              <button type="button" role="menuitem" onClick={() => onZOrderCommand("front", contextMenu.targetIds)}>
                <BringToFront size={13} />
                Bring to front
              </button>
              <button type="button" role="menuitem" onClick={() => onZOrderCommand("forward", contextMenu.targetIds)}>
                <ChevronUp size={13} />
                Bring forward
              </button>
              <button type="button" role="menuitem" onClick={() => onZOrderCommand("backward", contextMenu.targetIds)}>
                <ChevronDown size={13} />
                Send backward
              </button>
              <button type="button" role="menuitem" onClick={() => onZOrderCommand("back", contextMenu.targetIds)}>
                <SendToBack size={13} />
                Send to back
              </button>
            </div>,
            document.body
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
