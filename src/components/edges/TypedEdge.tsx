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
          }}
        >
          {shownLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
