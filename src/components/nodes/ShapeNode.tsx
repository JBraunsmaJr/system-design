import { useEffect, useRef } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { getShapeType } from "../../domain/shapeRegistry";
import { BidirectionalHandles } from "./BidirectionalHandles";
import type { ArchNodeData } from "../../domain/types";
import { useCanvasContext } from "../CanvasContext";

type ShapeNodeType = Node<ArchNodeData, "shape">;

interface ShapeNodeProps extends NodeProps<ShapeNodeType> {
  isEditing?: boolean;
  onStartEditing?: (nodeId: string) => void;
  onFinishEditing?: () => void;
  onChangeText?: (nodeId: string, text: string) => void;
}

export function ShapeNode({
  id,
  data,
  selected,
  isEditing: propIsEditing,
  onStartEditing: propOnStartEditing,
  onFinishEditing: propOnFinishEditing,
  onChangeText: propOnChangeText,
}: ShapeNodeProps) {
  const canvasContext = useCanvasContext();
  const isEditing = propIsEditing ?? (canvasContext?.editingLabelNodeId === id);
  const onStartEditing = propOnStartEditing ?? (canvasContext?.isPresenting ? undefined : canvasContext?.setEditingLabelNodeId);
  const onFinishEditing = propOnFinishEditing ?? (() => canvasContext?.setEditingLabelNodeId(null));
  const onChangeText = propOnChangeText ?? canvasContext?.onChangeTextNode;

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
      <BidirectionalHandles />
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
