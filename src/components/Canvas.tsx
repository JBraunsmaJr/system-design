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
} from "@xyflow/react";
import { TypedNode } from "./nodes/TypedNode";
import { TypedEdge } from "./edges/TypedEdge";
import { NODE_TYPES } from "../domain/nodeRegistry";
import { DRAG_MIME_TYPE } from "./Palette";
import type { ArchNodeData, ArchEdgeData } from "../domain/types";

const nodeTypes = { typed: TypedNode };
const edgeTypes = { typed: TypedEdge };

interface CanvasProps {
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
  onNodesChange: OnNodesChange<Node<ArchNodeData>>;
  onEdgesChange: OnEdgesChange<Edge<ArchEdgeData>>;
  onConnect: OnConnect;
  onSelectionChange: OnSelectionChangeFunc;
  onAddNode: (typeId: string, position: { x: number; y: number }) => void;
}

export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectionChange,
  onAddNode,
}: CanvasProps) {
  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const typeId = event.dataTransfer.getData(DRAG_MIME_TYPE);
      if (!typeId || !NODE_TYPES.some((n) => n.id === typeId)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onAddNode(typeId, position);
    },
    [screenToFlowPosition, onAddNode]
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
        defaultEdgeOptions={{ type: "typed" }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d6d9e0" />
        <MiniMap pannable zoomable className="canvas__minimap" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
