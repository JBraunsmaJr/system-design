import { useEffect, useRef } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { ArchNodeData } from "../../domain/types";
import { useCanvasContext } from "../CanvasContext";

type TextNodeType = Node<ArchNodeData, "text">;

interface TextNodeProps extends NodeProps<TextNodeType> {
  isEditing?: boolean;
  onStartEditing?: (nodeId: string) => void;
  onFinishEditing?: () => void;
  onChangeText?: (nodeId: string, text: string) => void;
}

const EDITING_DEFAULT_WIDTH = 220;

export function TextNode({
  id,
  data,
  selected,
  width,
  height,
  isEditing: propIsEditing,
  onStartEditing: propOnStartEditing,
  onFinishEditing: propOnFinishEditing,
  onChangeText: propOnChangeText,
}: TextNodeProps) {
  const canvasContext = useCanvasContext();
  const isEditing = propIsEditing ?? (canvasContext?.editingLabelNodeId === id);
  const onStartEditing = propOnStartEditing ?? (canvasContext?.isPresenting ? undefined : canvasContext?.setEditingLabelNodeId);
  const onFinishEditing = propOnFinishEditing ?? (() => canvasContext?.setEditingLabelNodeId(null));
  const onChangeText = propOnChangeText ?? canvasContext?.onChangeTextNode;

  const color = data.textColor ?? "#e7e9ee";
  const fontSize = data.fontSize ?? 16;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasManualSize = width != null && height != null;

  // Auto-grow height to fit content while editing, but only when there's no
  // manually-set size yet - once resized, the box owns its own dimensions.
  useEffect(() => {
    if (isEditing && textareaRef.current && !hasManualSize) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing, data.label, hasManualSize]);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        className="text-node text-node--editing nodrag nopan nowheel"
        value={data.label}
        style={{
          color,
          fontSize,
          width: hasManualSize ? "100%" : EDITING_DEFAULT_WIDTH,
          height: hasManualSize ? "100%" : undefined,
        }}
        onChange={(e) => onChangeText?.(id, e.target.value)}
        onBlur={() => onFinishEditing?.()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={40}
        minHeight={24}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <div
        className={`text-node${selected ? " is-selected" : ""}`}
        style={{
          color,
          fontSize,
          width: hasManualSize ? "100%" : undefined,
          height: hasManualSize ? "100%" : undefined,
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEditing?.(id);
        }}
      >
        {data.label || <span className="text-node__placeholder">Double-click to edit</span>}
      </div>
    </>
  );
}
