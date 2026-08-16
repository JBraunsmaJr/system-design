import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps, type Edge } from "@xyflow/react";
import { getEdgeType } from "../../domain/edgeRegistry";
import type { ArchEdgeData } from "../../domain/types";

type TypedEdgeType = Edge<ArchEdgeData, "typed">;

// Fallback dash pattern used only while animating a normally-solid (sync)
// edge, so there's something for the flow animation to actually move.
// Edges that already have their own dash pattern (async/data/file types)
// keep using it - it already supports the same marching effect.
const FLOW_FALLBACK_DASH = "8 6";

export function TypedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  markerStart,
  selected,
  style,
  animated,
}: EdgeProps<TypedEdgeType>) {
  const def = getEdgeType(data?.edgeType ?? "generic");
  const direction = data?.direction ?? "forward";
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
  });

  const shownLabel = data?.label?.trim() ? data.label : def.label;
  // `style.opacity` is how Canvas.tsx applies Presentation Mode / step-preview
  // dimming - unlike nodes, React Flow doesn't apply it automatically for
  // custom edge components, so it has to be merged in here explicitly.
  // Checking `=== 1` (not just truthy) distinguishes "explicitly focused
  // right now" from normal editing, where opacity is simply unset.
  const opacity = style?.opacity;
  const isFocused = opacity === 1;
  const flowClass = animated ? ` typed-edge--flow-${direction}` : "";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        // A "reverse" edge shows its arrowhead at the source end instead of
        // the target end, indicating the real traffic direction runs
        // opposite to how the edge happens to be drawn.
        markerEnd={direction === "reverse" ? undefined : markerEnd}
        markerStart={direction === "reverse" ? markerStart : undefined}
        className={`typed-edge${flowClass}`}
        style={{
          stroke: def.color,
          strokeWidth: selected || isFocused ? 2.5 : 1.75,
          strokeDasharray: animated ? def.dash ?? FLOW_FALLBACK_DASH : def.dash,
          opacity,
          filter: isFocused ? `drop-shadow(0 0 5px ${def.color})` : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`typed-edge__label${selected ? " is-selected" : ""}`}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            borderColor: def.color,
            color: def.color,
            opacity,
            boxShadow: isFocused ? `0 0 8px ${def.color}99` : undefined,
          }}
        >
          {shownLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
