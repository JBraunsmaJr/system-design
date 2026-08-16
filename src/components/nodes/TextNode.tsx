import type { NodeProps, Node } from "@xyflow/react";
import type { ArchNodeData } from "../../domain/types";

type TextNodeType = Node<ArchNodeData, "text">;

/**
 * A plain-text canvas annotation - deliberately no icon/card/category chrome
 * (that's what a "Note" logic node is for). Color and font size are edited
 * via the Inspector, same pattern as everything else. Not connectable - it
 * doesn't make sense to draw a traffic/flow edge to a text label.
 */
export function TextNode({ data, selected }: NodeProps<TextNodeType>) {
  const color = data.textColor ?? "#e7e9ee";
  const fontSize = data.fontSize ?? 16;

  return (
    <div className={`text-node${selected ? " is-selected" : ""}`} style={{ color, fontSize }}>
      {data.label || "Text"}
    </div>
  );
}
