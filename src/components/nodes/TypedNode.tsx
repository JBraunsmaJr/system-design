import { type NodeProps, type Node } from "@xyflow/react";
import { Maximize2 } from "lucide-react";
import * as Icons from "lucide-react";
import { getNodeType, CATEGORY_LABELS } from "../../domain/nodeRegistry";
import { BidirectionalHandles } from "./BidirectionalHandles";
import type { ArchNodeData } from "../../domain/types";

type TypedNodeType = Node<ArchNodeData, "typed">;

interface TypedNodeProps extends NodeProps<TypedNodeType> {
  // Not part of NodeProps - injected via the nodeTypes factory in Canvas.tsx
  // so this component can trigger navigation without needing its own
  // ReactFlow-context plumbing. Absent (and the button hidden) while
  // presenting, since editing/navigation are locked in that mode.
  onDrillInto?: (nodeId: string) => void;
}

const VISIBLE_PROPERTY_CHIPS = 2;

export function TypedNode({ id, data, selected, onDrillInto }: TypedNodeProps) {
  const def = getNodeType(data.nodeType);
  const iconName = data.icon ?? def?.icon;
  const IconComponent =
    (iconName && (Icons[iconName as keyof typeof Icons] as Icons.LucideIcon)) || Icons.Box;
  const accent = data.color ?? def?.color ?? "#98A2B3";
  const hasSubDiagram = (data.subDiagram?.nodes.length ?? 0) > 0;
  // The "Custom" type's category label and its own type label are both
  // literally "Custom", so the usual "Category · Type" subtitle would read
  // as "Custom · Custom" - show the description there instead, since that's
  // the more useful thing a fully generic node actually has to say about
  // itself.
  const isCustom = data.nodeType === "custom";

  const properties = Object.entries(data.properties).filter(([key]) => key.trim() !== "");
  const visibleProperties = properties.slice(0, VISIBLE_PROPERTY_CHIPS);
  const hiddenCount = properties.length - visibleProperties.length;

  return (
    <div
      className={`typed-node${selected ? " is-selected" : ""}`}
      style={{ borderLeftColor: accent }}
    >
      <BidirectionalHandles />

      <div className="typed-node__body">
        <div className="typed-node__icon" style={{ background: `${accent}1a`, color: accent }}>
          <IconComponent size={16} strokeWidth={2} />
        </div>
        <div className="typed-node__text">
          <div className="typed-node__label">{data.label}</div>
          {isCustom ? (
            data.description && <div className="typed-node__description">{data.description}</div>
          ) : (
            <div className="typed-node__type">
              {def ? `${CATEGORY_LABELS[def.category]} · ${def.label}` : data.nodeType}
            </div>
          )}
        </div>
      </div>

      {properties.length > 0 && (
        <div className="typed-node__chips">
          {visibleProperties.map(([key, value]) => (
            <span className="prop-chip" key={key} title={`${key}: ${value}`}>
              {key}: {value}
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="prop-chip prop-chip--more">
              +{hiddenCount}
              <div className="prop-chip__tooltip nodrag">
                {properties.map(([key, value]) => (
                  <div key={key} className="prop-chip__tooltip-row">
                    <strong>{key}:</strong> {value}
                  </div>
                ))}
              </div>
            </span>
          )}
        </div>
      )}

      {onDrillInto && (
        <button
          type="button"
          className={`typed-node__drill${hasSubDiagram ? " has-content" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onDrillInto(id);
          }}
          title={hasSubDiagram ? "Open sub-diagram" : "Create a sub-diagram inside this node"}
          aria-label="Drill into sub-diagram"
        >
          <Maximize2 size={11} />
        </button>
      )}

    </div>
  );
}
