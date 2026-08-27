import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { getShapeType } from "../../domain/shapeRegistry";
import type { ArchNodeData } from "../../domain/types";

type ShapeNodeType = Node<ArchNodeData, "shape">;

/**
 * A plain drawn shape (Circle/Square/Rectangle) - purely visual, like Text
 * annotations. No label/properties/sub-diagram; just a resizable, colored
 * region for highlighting an area of the diagram. Circle and Square keep a
 * 1:1 aspect ratio while resizing; Rectangle resizes freely.
 */
export function ShapeNode({ data, selected }: NodeProps<ShapeNodeType>) {
  const def = getShapeType(data.nodeType);
  const color = data.color ?? def?.color ?? "#5B7CFA";
  const isCircle = data.nodeType === "circle";

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={30}
        minHeight={30}
        keepAspectRatio={def?.keepAspectRatio ?? false}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <div
        className={`shape-node${isCircle ? " is-circle" : ""}${selected ? " is-selected" : ""}`}
        style={{
          borderColor: selected ? "var(--accent)" : color,
          background: `${color}26`,
        }}
      />
    </>
  );
}
