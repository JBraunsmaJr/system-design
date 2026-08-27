import { useEffect, useRef } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { ArchNodeData } from "../../domain/types";

type TextNodeType = Node<ArchNodeData, "text">;

interface TextNodeProps extends NodeProps<TextNodeType> {
  // Injected via the nodeTypes factory in Canvas.tsx, same pattern as
  // TypedNode's onDrillInto - lets this node trigger/respond to app-level
  // "which text node is being edited right now" state without needing its
  // own context plumbing.
  isEditing?: boolean;
  onStartEditing?: (nodeId: string) => void;
  onFinishEditing?: () => void;
  onChangeText?: (nodeId: string, text: string) => void;
}

const EDITING_DEFAULT_WIDTH = 220;

/**
 * A plain-text canvas annotation - deliberately no icon/card/category chrome
 * (that's what a "Note" logic node is for). Color and font size are edited
 * via the Inspector; the text itself is editable right on the canvas:
 * double-click to enter edit mode, click away or press Escape to finish.
 * Not connectable - it doesn't make sense to draw a traffic/flow edge to a
 * text label.
 *
 * Sizing: a fresh text node has no explicit width/height and just wraps
 * tightly around whatever you type (via the height auto-grow effect below).
 * Dragging a resize handle (only shown when selected, not while editing)
 * gives it an explicit width/height from then on, at which point it fills
 * that box instead of auto-sizing - `width`/`height` here reflect whichever
 * state it's currently in.
 */
export function TextNode({
  id,
  data,
  selected,
  width,
  height,
  isEditing,
  onStartEditing,
  onFinishEditing,
  onChangeText,
}: TextNodeProps) {
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
