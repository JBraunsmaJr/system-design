import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import * as Icons from "lucide-react";
import { getGroupType } from "../../domain/groupRegistry";
import { BidirectionalHandles } from "./BidirectionalHandles";
import type { ArchNodeData } from "../../domain/types";

type GroupNodeType = Node<ArchNodeData, "group">;

/**
 * A labeled boundary that other nodes can be dropped/dragged into (see
 * Canvas.tsx's onNodeDragStop + App.tsx's onReparentNode/onAdoptIntoGroup).
 * Editing the label/description/tags goes through the same Inspector as
 * regular nodes - this component owns layout plus the per-kind visual
 * identity (icon/color/border style) looked up from groupRegistry.ts.
 *
 * The interior is deliberately click-through (pointer-events: none on the
 * main div) - only the border strips and the label chip are clickable, so
 * selecting/dragging the boundary itself requires clicking its edges or
 * title, the same way draw.io/Figma-style "frame" containers work. Without
 * this, the boundary's own (large, node-layer, therefore visually "on top
 * of" edges) div was intercepting clicks meant for edges passing through
 * it, and sometimes child nodes too, whenever a click missed a child's own
 * smaller hit-box but still landed within the boundary's much larger one.
 *
 * A group/boundary can also be connected to other nodes directly - e.g. an
 * edge from a "Kubernetes Cluster" boundary to a "Database" node,
 * representing the whole subsystem rather than one specific node inside
 * it. BidirectionalHandles is the same shared handle set TypedNode and
 * ShapeNode already use, kept as a sibling of the click-through div below
 * for the same reason NodeResizer is - pointer-events:none is inherited by
 * descendants, so a handle nested inside that div would inherit it too and
 * become undraggable; as a sibling it's unaffected regardless of the
 * interior's click-through state.
 */
export function GroupNode({ data, selected }: NodeProps<GroupNodeType>) {
  const def = getGroupType(data.nodeType);
  const accent = data.color ?? def?.color ?? "#7C8598";
  const IconComponent =
    (def && (Icons[def.icon as keyof typeof Icons] as Icons.LucideIcon)) || Icons.SquareDashed;
  const borderStyle = def?.borderStyle ?? "dashed";
  const borderColor = selected ? "var(--accent)" : `${accent}99`;

  return (
    <>
      {/* Sibling, not nested inside the click-through div below - pointer-events
          is inherited by default, and NodeResizer's own handles need to stay
          fully interactive regardless of the group's interior being
          click-through. Same reasoning applies to BidirectionalHandles just
          below it. */}
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={140}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <BidirectionalHandles />
      <div
        className={`group-node${selected ? " is-selected" : ""}`}
        style={{
          borderStyle,
          borderWidth: borderStyle === "double" ? 4 : 1.5,
          borderColor,
          background: selected ? "rgba(91, 124, 250, 0.09)" : `${accent}0d`,
        }}
      >
        {/* Clickable border frame - 4 thin strips along each edge, each
            explicitly re-enabling pointer-events since the parent above
            turns them off. Slightly thicker than the visual border itself
            for an easier, more forgiving click target. */}
        <div className="group-node__edge-hit group-node__edge-hit--top" />
        <div className="group-node__edge-hit group-node__edge-hit--right" />
        <div className="group-node__edge-hit group-node__edge-hit--bottom" />
        <div className="group-node__edge-hit group-node__edge-hit--left" />

        <div className="group-node__label" style={{ borderColor, color: accent }}>
          {/* eslint-disable-next-line react-hooks/static-components -- stable lookup, see TypedNode.tsx */}
          <IconComponent size={12} />
          <span>{data.label}</span>
        </div>
      </div>
    </>
  );
}
