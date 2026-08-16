import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import * as Icons from "lucide-react";
import { getGroupType } from "../../domain/groupRegistry";
import type { ArchNodeData } from "../../domain/types";

type GroupNodeType = Node<ArchNodeData, "group">;

/**
 * A labeled boundary that other nodes can be dropped/dragged into (see
 * Canvas.tsx's onNodeDragStop + App.tsx's onReparentNode/onAdoptIntoGroup).
 * Editing the label/description/tags goes through the same Inspector as
 * regular nodes - this component owns layout plus the per-kind visual
 * identity (icon/color/border style) looked up from groupRegistry.ts, since
 * every boundary kind previously rendered identically regardless of what it
 * actually represented.
 */
export function GroupNode({ data, selected }: NodeProps<GroupNodeType>) {
  const def = getGroupType(data.nodeType);
  const accent = def?.color ?? "#7C8598";
  const IconComponent =
    (def && (Icons[def.icon as keyof typeof Icons] as Icons.LucideIcon)) || Icons.SquareDashed;
  const borderStyle = def?.borderStyle ?? "dashed";

  return (
    <div
      className={`group-node${selected ? " is-selected" : ""}`}
      style={{
        borderStyle,
        borderWidth: borderStyle === "double" ? 4 : 1.5,
        borderColor: selected ? "var(--accent)" : `${accent}99`,
        background: selected ? "rgba(91, 124, 250, 0.09)" : `${accent}0d`,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={140}
        lineClassName="group-node__resize-line"
        handleClassName="group-node__resize-handle"
      />
      <div
        className="group-node__label"
        style={{ borderColor: selected ? "var(--accent)" : `${accent}99`, color: accent }}
      >
        {/* eslint-disable-next-line react-hooks/static-components -- stable lookup, see TypedNode.tsx */}
        <IconComponent size={12} />
        <span>{data.label}</span>
      </div>
    </div>
  );
}
