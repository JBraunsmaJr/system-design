import { useEffect, useRef } from "react";
import { NodeResizer, type NodeProps, type Node, Handle, Position } from "@xyflow/react";
import { globalShapeRegistry, type ConnectionPoint } from "../../domain/shapeRegistry";
import { BidirectionalHandles } from "./BidirectionalHandles";
import { SvgShapeRenderer } from "./SvgShapeRenderer";
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
  width: propWidth,
  height: propHeight,
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

  const def = globalShapeRegistry.getShape(data.nodeType);
  const color = data.color ?? def?.defaults.color ?? "#5B7CFA";
  const fontSize = data.fontSize ?? 16;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const width = propWidth ?? def?.defaults.width ?? 120;
  const height = propHeight ?? def?.defaults.height ?? 100;

  const keepAspectRatio = def?.constraints?.keepAspectRatio ?? (data.nodeType === "circle" || data.nodeType === "square");
  const minWidth = def?.constraints?.minWidth ?? 30;
  const minHeight = def?.constraints?.minHeight ?? 30;

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  const connectionPoints: ConnectionPoint[] = def?.connectionPoints ?? [];
  const hasCustomPoints = connectionPoints.length > 0;

  return (
    <>
      <NodeResizer
        isVisible={!!selected && !isEditing}
        minWidth={minWidth}
        minHeight={minHeight}
        keepAspectRatio={keepAspectRatio}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />

      {hasCustomPoints ? (
        <>
          {connectionPoints.map((pt) => {
            let pos = Position.Top;
            if (pt.direction === "right") pos = Position.Right;
            else if (pt.direction === "bottom") pos = Position.Bottom;
            else if (pt.direction === "left") pos = Position.Left;
            else if (pt.x > 0.75) pos = Position.Right;
            else if (pt.x < 0.25) pos = Position.Left;
            else if (pt.y > 0.75) pos = Position.Bottom;

            return (
              <div key={pt.id}>
                <Handle
                  id={`target-${pt.id}`}
                  type="target"
                  position={pos}
                  style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                />
                <Handle
                  id={`source-${pt.id}`}
                  type="source"
                  position={pos}
                  style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                />
              </div>
            );
          })}
        </>
      ) : (
        <BidirectionalHandles />
      )}

      <div
        className={`shape-node-wrapper${selected ? " is-selected" : ""}`}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minWidth,
          minHeight,
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEditing?.(id);
        }}
      >
        {def ? (
          <SvgShapeRenderer
            geometry={def.geometry}
            width={width}
            height={height}
            color={selected ? "var(--accent)" : color}
            style={def.defaults.style}
            iconId={data.icon ?? def.iconId}
          />
        ) : (
          <div
            className={`shape-node${data.nodeType === "circle" ? " is-circle" : ""}${selected ? " is-selected" : ""}`}
            style={{
              width: "100%",
              height: "100%",
              borderColor: selected ? "var(--accent)" : color,
              background: `${color}26`,
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 12px",
            pointerEvents: isEditing ? "auto" : "none",
          }}
        >
          {isEditing ? (
            <textarea
              ref={textareaRef}
              className="shape-node__text-input nodrag nopan nowheel"
              style={{
                fontSize,
                width: "100%",
                height: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                textAlign: "center",
                resize: "none",
                color: "var(--text)",
              }}
              value={data.label}
              onChange={(e) => onChangeText?.(id, e.target.value)}
              onBlur={() => onFinishEditing?.()}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur();
              }}
            />
          ) : (
            data.label && (
              <div
                className="shape-node__text"
                style={{
                  fontSize,
                  textAlign: "center",
                  wordBreak: "break-word",
                  userSelect: "none",
                }}
              >
                {data.label}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
