import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import * as Icons from "lucide-react";
import { getNodeType, CATEGORY_LABELS } from "../../domain/nodeRegistry";
import type { ArchNodeData } from "../../domain/types";

type TypedNodeType = Node<ArchNodeData, "typed">;

export function TypedNode({ data, selected }: NodeProps<TypedNodeType>) {
  const def = getNodeType(data.nodeType);
  const IconComponent =
    (def && (Icons[def.icon as keyof typeof Icons] as Icons.LucideIcon)) || Icons.Box;
  const accent = def?.color ?? "#98A2B3";

  return (
    <div
      className={`typed-node${selected ? " is-selected" : ""}`}
      style={{ borderLeftColor: accent }}
    >
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="target-left" type="target" position={Position.Left} />

      <div className="typed-node__body">
        <div className="typed-node__icon" style={{ background: `${accent}1a`, color: accent }}>
          {/* eslint-disable-next-line react-hooks/static-components -- IconComponent is a stable
              lookup from the lucide-react module map, not a component defined during render. */}
          <IconComponent size={16} strokeWidth={2} />
        </div>
        <div className="typed-node__text">
          <div className="typed-node__label">{data.label}</div>
          <div className="typed-node__type">
            {def ? `${CATEGORY_LABELS[def.category]} · ${def.label}` : data.nodeType}
          </div>
        </div>
      </div>

      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
    </div>
  );
}
