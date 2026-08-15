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
} from "@xyflow/react";
import { TypedNode } from "./nodes/TypedNode";
import { TypedEdge } from "./edges/TypedEdge";
import { GroupNode } from "./nodes/GroupNode";
import { PresentationOverlay } from "./PresentationOverlay";
import { NODE_TYPES } from "../domain/nodeRegistry";
import { GROUP_TYPES } from "../domain/groupRegistry";
import { DRAG_MIME_TYPE, GROUP_DRAG_MIME_TYPE } from "./Palette";
import type { ArchNodeData, ArchEdgeData, Scenario, ScenarioStep } from "../domain/types";

const nodeTypes = { typed: TypedNode, group: GroupNode };
const edgeTypes = { typed: TypedEdge };

const DIMMED_NODE_OPACITY = 0.15;
const DIMMED_EDGE_OPACITY = 0.12;

export interface PresentationState {
  scenario: Scenario;
  step: ScenarioStep;
  stepIndex: number;
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
  onReparentNode: (nodeId: string, newParentId: string | null) => void;
  presentation: PresentationState | null;
  onPresentNext: () => void;
  onPresentPrev: () => void;
  onExitPresenting: () => void;
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
  onReparentNode,
  presentation,
  onPresentNext,
  onPresentPrev,
  onExitPresenting,
}: CanvasProps) {
  const { screenToFlowPosition, getIntersectingNodes, fitView } = useReactFlow<Node<ArchNodeData>>();

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
      }
    },
    [screenToFlowPosition, onAddNode, onAddGroup]
  );

  // Dropping (or dragging) a regular node so it overlaps a group/boundary
  // makes it a child of that group - it then moves with the group. Dragging
  // it back out releases it. See App.tsx's onReparentNode for the state math.
  const onNodeDragStop = useCallback<OnNodeDrag<Node<ArchNodeData>>>(
    (_event, draggedNode) => {
      if (draggedNode.type === "group") return;
      const intersectingGroup = getIntersectingNodes(draggedNode).find((n) => n.type === "group");
      onReparentNode(draggedNode.id, intersectingGroup ? intersectingGroup.id : null);
    },
    [getIntersectingNodes, onReparentNode]
  );

  // Presentation Mode dims everything except the current step's focus set.
  // Group nodes can be focus targets too (a step can highlight a boundary,
  // not just the things in it) since they're ordinary node ids underneath.
  const displayNodes = useMemo(() => {
    if (!presentation) return nodes;
    const focusIds = new Set(presentation.step.focusNodeIds);
    return nodes.map((n) => ({
      ...n,
      style: { ...n.style, opacity: focusIds.has(n.id) ? 1 : DIMMED_NODE_OPACITY },
    }));
  }, [nodes, presentation]);

  const displayEdges = useMemo(() => {
    if (!presentation) return edges;
    const focusIds = new Set(presentation.step.focusEdgeIds);
    return edges.map((e) => ({
      ...e,
      animated: focusIds.has(e.id),
      style: { ...e.style, opacity: focusIds.has(e.id) ? 1 : DIMMED_EDGE_OPACITY },
    }));
  }, [edges, presentation]);

  // Auto-frame the camera on the current step's focus nodes. Keyed off the
  // step id (a primitive) rather than the `presentation` object itself, so
  // this only re-fits when the step actually changes, not on every render.
  const stepId = presentation?.step.id;
  useEffect(() => {
    if (!presentation) return;
    const ids = presentation.step.focusNodeIds;
    if (ids.length === 0) return;
    fitView({ nodes: ids.map((id) => ({ id })), padding: 0.35, duration: 450 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, [stepId, fitView]);

  const isPresenting = presentation !== null;

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
