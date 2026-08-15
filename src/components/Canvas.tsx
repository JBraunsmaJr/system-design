import { useCallback, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
import { NODE_TYPES } from "../domain/nodeRegistry";
import { GROUP_TYPES } from "../domain/groupRegistry";
import { DRAG_MIME_TYPE, GROUP_DRAG_MIME_TYPE } from "./Palette";
import type { ArchNodeData, ArchEdgeData } from "../domain/types";

const nodeTypes = { typed: TypedNode, group: GroupNode };
const edgeTypes = { typed: TypedEdge };

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
}: CanvasProps) {
  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow<Node<ArchNodeData>>();

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

  return (
    <div className="canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
        defaultEdgeOptions={{ type: "typed" }}
        deleteKeyCode={null}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255, 255, 255, 0.07)" />
        <MiniMap
          pannable
          zoomable
          className="canvas__minimap"
          nodeColor="#3a3f4f"
          maskColor="rgba(15, 17, 23, 0.65)"
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
