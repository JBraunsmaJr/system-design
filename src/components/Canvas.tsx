import { useCallback, useEffect, useMemo, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type OnSelectionChangeFunc,
  type OnNodeDrag,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { TypedNode } from "./nodes/TypedNode";
import { TypedEdge } from "./edges/TypedEdge";
import { GroupNode } from "./nodes/GroupNode";
import { TextNode } from "./nodes/TextNode";
import { PresentationOverlay } from "./PresentationOverlay";
import { Breadcrumb } from "./Breadcrumb";
import { NODE_TYPES } from "../domain/nodeRegistry";
import { GROUP_TYPES } from "../domain/groupRegistry";
import { DRAG_MIME_TYPE, GROUP_DRAG_MIME_TYPE, TEXT_DRAG_MIME_TYPE } from "./Palette";
import type { ArchNodeData, ArchEdgeData, Scenario, ScenarioStep } from "../domain/types";

const edgeTypes = { typed: TypedEdge };

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
  onSelectionChange: OnSelectionChangeFunc;
  onAddNode: (typeId: string, position: { x: number; y: number }) => void;
  onAddGroup: (typeId: string, position: { x: number; y: number }) => void;
  onAddText: (position: { x: number; y: number }) => void;
  onReparentNode: (nodeId: string, newParentId: string | null) => void;
  onAdoptIntoGroup: (groupId: string, nodeIds: string[]) => void;
  presentation: PresentationState | null;
  previewFocus: FocusSet | null;
  onPresentNext: () => void;
  onPresentPrev: () => void;
  onExitPresenting: () => void;
  breadcrumbLabels: string[];
  onDrillInto: (nodeId: string) => void;
  onNavigateToRoot: () => void;
  onNavigateToPathIndex: (index: number) => void;
}

export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectionChange,
  onAddNode,
  onAddGroup,
  onAddText,
  onReparentNode,
  onAdoptIntoGroup,
  presentation,
  previewFocus,
  onPresentNext,
  onPresentPrev,
  onExitPresenting,
  breadcrumbLabels,
  onDrillInto,
  onNavigateToRoot,
  onNavigateToPathIndex,
}: CanvasProps) {
  const { screenToFlowPosition, getIntersectingNodes, fitView } = useReactFlow<Node<ArchNodeData>>();

  const isPresenting = presentation !== null;
  // Full presentation always wins over a step preview if somehow both were
  // active; in practice previewFocus is only ever set while NOT presenting
  // (see App.tsx), so this is mostly a defensive fallback.
  const activeFocus: FocusSet | null = useMemo(
    () =>
      presentation
        ? { nodeIds: presentation.step.focusNodeIds, edgeIds: presentation.step.focusEdgeIds }
        : previewFocus,
    [presentation, previewFocus]
  );

  // TypedNode needs to trigger navigation but isn't rendered with any extra
  // props by React Flow itself - wrapping it here (rather than a stable
  // module-level `nodeTypes` constant) is the standard way to thread a
  // callback into a custom node type. Disabled while presenting, since
  // drilling into a node would break the locked slideshow view.
  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      typed: (props) => <TypedNode {...props} onDrillInto={isPresenting ? undefined : onDrillInto} />,
      group: GroupNode,
      text: TextNode,
    }),
    [isPresenting, onDrillInto]
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

      if (event.dataTransfer.getData(TEXT_DRAG_MIME_TYPE)) {
        onAddText(position);
      }
    },
    [screenToFlowPosition, onAddNode, onAddGroup, onAddText]
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
    [getIntersectingNodes, onReparentNode, onAdoptIntoGroup]
  );

  const onNodeDoubleClick = useCallback<NodeMouseHandler<Node<ArchNodeData>>>(
    (_event, node) => {
      if (isPresenting || node.type === "group" || node.type === "text") return;
      onDrillInto(node.id);
    },
    [isPresenting, onDrillInto]
  );

  // Dims everything except the active focus set (full presentation step, or
  // a lightweight step preview from ScenarioPanel) and adds a glow class to
  // focused elements so the highlight reads clearly, not just as "slightly
  // less dim." Group nodes and text annotations can be focus targets too -
  // they're ordinary node ids underneath.
  const displayNodes = useMemo(() => {
    if (!activeFocus) return nodes;
    const focusIds = new Set(activeFocus.nodeIds);
    return nodes.map((n) => ({
      ...n,
      className: focusIds.has(n.id) ? "is-presentation-focus" : undefined,
      style: { ...n.style, opacity: focusIds.has(n.id) ? 1 : DIMMED_NODE_OPACITY },
    }));
  }, [nodes, activeFocus]);

  const displayEdges = useMemo(() => {
    if (!activeFocus) return edges;
    const focusIds = new Set(activeFocus.edgeIds);
    return edges.map((e) => ({
      ...e,
      animated: focusIds.has(e.id),
      style: { ...e.style, opacity: focusIds.has(e.id) ? 1 : DIMMED_EDGE_OPACITY },
    }));
  }, [edges, activeFocus]);

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
  // breadcrumb path changes rather than leaving the previous level's pan/zoom.
  const pathKey = breadcrumbLabels.join(">");
  useEffect(() => {
    fitView({ padding: 0.2, duration: 300 });
  }, [pathKey, fitView]);

  return (
    <div className="canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        defaultEdgeOptions={{
          type: "typed",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#98a2b3" },
          markerStart: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#98a2b3" },
        }}
        deleteKeyCode={null}
        nodesDraggable={!isPresenting}
        nodesConnectable={!isPresenting}
        elementsSelectable={!isPresenting}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255, 255, 255, 0.07)" />
        {!isPresenting && (
          <MiniMap
            pannable
            zoomable
            className="canvas__minimap"
            nodeColor="#3a3f4f"
            maskColor="rgba(15, 17, 23, 0.65)"
          />
        )}
        {!isPresenting && <Controls />}
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
            onNext={onPresentNext}
            onPrev={onPresentPrev}
            onExit={onExitPresenting}
          />
        )}
      </ReactFlow>
    </div>
  );
}
