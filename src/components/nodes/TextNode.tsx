import { useEffect, useRef } from "react";
import type { NodeProps, Node } from "@xyflow/react";
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

/**
 * A plain-text canvas annotation - deliberately no icon/card/category chrome
 * (that's what a "Note" logic node is for). Color and font size are still
 * edited via the Inspector, but the text itself is editable right on the
 * canvas: double-click to enter edit mode, click away or press Escape to
 * finish. Not connectable - it doesn't make sense to draw a traffic/flow
 * edge to a text label.
 */
export function TextNode({
  id,
  data,
  selected,
  isEditing,
  onStartEditing,
  onFinishEditing,
  onChangeText,
}: TextNodeProps) {
  const color = data.textColor ?? "#e7e9ee";
  const fontSize = data.fontSize ?? 16;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow height to fit content while editing (width stays fixed - see
  // the .text-node--editing CSS comment for why a truly auto-width textarea
  // isn't worth the complexity here).
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing, data.label]);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        className="text-node text-node--editing nodrag nopan nowheel"
        value={data.label}
        style={{ color, fontSize }}
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
    <div
      className={`text-node${selected ? " is-selected" : ""}`}
      style={{ color, fontSize }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEditing?.(id);
      }}
    >
      {data.label || <span className="text-node__placeholder">Double-click to edit</span>}
    </div>
  );
}
