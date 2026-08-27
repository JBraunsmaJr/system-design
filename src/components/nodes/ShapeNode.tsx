import { useEffect, useRef } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { getShapeType } from "../../domain/shapeRegistry";
import type { ArchNodeData } from "../../domain/types";

type ShapeNodeType = Node<ArchNodeData, "shape">;

interface ShapeNodeProps extends NodeProps<ShapeNodeType> {
  // Same "which node is being text-edited right now" mechanism TextNode
  // uses - shared state in Canvas.tsx, since a shape's optional label works
  // exactly the same way (double-click to edit, blur/Escape to finish).
  isEditing?: boolean;
  onStartEditing?: (nodeId: string) => void;
  onFinishEditing?: () => void;
  onChangeText?: (nodeId: string, text: string) => void;
}

/**
 * A plain drawn shape (Circle/Square/Rectangle) - purely visual, like Text
 * annotations, but can optionally hold a short centered label (double-click
 * to edit). No properties/tags/sub-diagram. Circle and Square keep a 1:1
 * aspect ratio while resizing; Rectangle resizes freely.
 */
export function ShapeNode({
  id,
  data,
  selected,
  isEditing,
  onStartEditing,
  onFinishEditing,
  onChangeText,
}: ShapeNodeProps) {
  const def = getShapeType(data.nodeType);
  const color = data.color ?? def?.color ?? "#5B7CFA";
  const fontSize = data.fontSize ?? 16;
  const isCircle = data.nodeType === "circle";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  return (
    <>
      <NodeResizer
        isVisible={!!selected && !isEditing}
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
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEditing?.(id);
        }}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="shape-node__text-input nodrag nopan nowheel"
            style={{ fontSize }}
            value={data.label}
            onChange={(e) => onChangeText?.(id, e.target.value)}
            onBlur={() => onFinishEditing?.()}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
        ) : (
          data.label && (
            <div className="shape-node__text" style={{ fontSize }}>
              {data.label}
            </div>
          )
        )}
      </div>
    </>
  );
}
