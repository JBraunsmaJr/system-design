import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { ArchNodeData } from "../../domain/types";

type GroupNodeType = Node<ArchNodeData, "group">;

/**
 * A labeled boundary that other nodes can be dropped/dragged into (see
 * Canvas.tsx's onNodeDragStop + App.tsx's onReparentNode). Editing the
 * label/description/tags goes through the same Inspector as regular nodes -
 * this component only owns layout (resize handles + the label chip).
 */
export function GroupNode({ data, selected }: NodeProps<GroupNodeType>) {
  return (
    <div className={`group-node${selected ? " is-selected" : ""}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={140}
        lineClassName="group-node__resize-line"
        handleClassName="group-node__resize-handle"
      />
      <div className="group-node__label">{data.label}</div>
    </div>
  );
}
