import { Handle, Position } from "@xyflow/react";

/**
 * One source + one target handle stacked at each of the 4 sides, so a
 * connection can be dragged starting from ANY side of a node - see
 * Canvas.tsx's handleConnect for how the actual drag direction still gets
 * respected even though React Flow's own source/target resolution is
 * purely handle-type-based, not drag-direction-based. Shared between
 * TypedNode and ShapeNode rather than duplicated.
 */
export function BidirectionalHandles() {
  return (
    <>
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="source-top" type="source" position={Position.Top} />
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle id="source-left" type="source" position={Position.Left} />
      <Handle id="target-right" type="target" position={Position.Right} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
    </>
  );
}
