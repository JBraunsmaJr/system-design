import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps, type Edge } from "@xyflow/react";
import { getEdgeType } from "../../domain/edgeRegistry";
import type { ArchEdgeData } from "../../domain/types";

type TypedEdgeType = Edge<ArchEdgeData, "typed">;

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
  selected,
  style,
}: EdgeProps<TypedEdgeType>) {
  const def = getEdgeType(data?.edgeType ?? "generic");
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
  // `style` is how Canvas.tsx applies Presentation Mode dimming (opacity) to
  // edges - unlike nodes, React Flow doesn't apply it automatically for
  // custom edge components, so it has to be merged in here explicitly.
  const opacity = style?.opacity;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: def.color,
          strokeWidth: selected ? 2.5 : 1.75,
          strokeDasharray: def.dash,
          opacity,
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
          }}
        >
          {shownLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
