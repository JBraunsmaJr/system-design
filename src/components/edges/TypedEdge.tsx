import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import { getEdgeType } from "../../domain/edgeRegistry";
import type { ArchEdgeData } from "../../domain/types";

type TypedEdgeType = Edge<ArchEdgeData, "typed">;

interface TypedEdgeProps extends EdgeProps<TypedEdgeType> {
  // Injected via the edgeTypes factory in Canvas.tsx, same pattern as
  // TypedNode's onDrillInto - lets the label be dragged to reposition it
  // without this component needing its own state-management plumbing.
  onUpdateEdge?: (id: string, patch: Partial<ArchEdgeData>) => void;
}

// Fallback dash pattern used only while animating a normally-solid (sync)
// edge, so there's something for the flow animation to actually move.
// Edges that already have their own dash pattern (async/data/file types)
// keep using it - it already supports the same marching effect.
const FLOW_FALLBACK_DASH = "8 6";

// Below this many pixels of pointer movement, a press-and-release on the
// label is treated as a click, not a drag.
const DRAG_THRESHOLD = 3;

// How many points along the path to sample when looking for the closest
// one to the cursor during a drag. 50 gives ~2% resolution along the path,
// which is plenty for a label-positioning UI - and getPointAtLength is a
// native browser call, so 50 of them per pointermove is comfortably cheap.
const PATH_SAMPLE_COUNT = 50;

function findClosestPointOnPath(pathEl: SVGPathElement, targetX: number, targetY: number) {
  const totalLength = pathEl.getTotalLength();
  if (totalLength === 0) {
    const p = pathEl.getPointAtLength(0);
    return { t: 0, x: p.x, y: p.y };
  }
  let bestT = 0.5;
  let bestPoint = pathEl.getPointAtLength(totalLength * 0.5);
  let bestDist = Infinity;
  for (let i = 0; i <= PATH_SAMPLE_COUNT; i++) {
    const t = i / PATH_SAMPLE_COUNT;
    const point = pathEl.getPointAtLength(totalLength * t);
    const dist = Math.hypot(point.x - targetX, point.y - targetY);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
      bestPoint = point;
    }
  }
  return { t: bestT, x: bestPoint.x, y: bestPoint.y };
}

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
  onUpdateEdge,
}: TypedEdgeProps) {
  const { screenToFlowPosition } = useReactFlow();
  const def = getEdgeType(data?.edgeType ?? "generic");
  const color = data?.color ?? def.color;
  const direction = data?.direction ?? "forward";
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
  });

  const anchorT = data?.labelAnchorT ?? 0.5;
  const offsetX = data?.labelOffsetX ?? 0;
  const offsetY = data?.labelOffsetY ?? 0;

  // A hidden path used purely for geometry queries (getTotalLength /
  // getPointAtLength) - kept separate from the visible BaseEdge path since
  // it's not confirmed whether BaseEdge forwards refs to its underlying
  // <path> element, and this way it doesn't matter either way.
  const measurePathRef = useRef<SVGPathElement>(null);
  const [anchorPoint, setAnchorPoint] = useState(() => ({
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  }));

  // Re-measures the anchor point whenever the path's actual shape changes
  // (a node moved) or the stored anchor fraction changes (label was
  // repositioned). This is the actual fix for the label drifting away from
  // the line: the OLD approach stored a raw pixel offset from a
  // getSmoothStepPath-computed "midpoint" that can jump discontinuously
  // when the path's routing topology changes (e.g. a node moves far enough
  // that the L-shaped route now bends the other way) - a fixed pixel
  // offset from THAT point ends up nowhere near the new path. Anchoring by
  // fraction-of-length instead means the anchor point is always
  // recalculated to sit exactly ON the current path, however it's shaped.
  useLayoutEffect(() => {
    const pathEl = measurePathRef.current;
    if (!pathEl) return;
    const totalLength = pathEl.getTotalLength();
    if (totalLength === 0) return;
    const point = pathEl.getPointAtLength(totalLength * anchorT);
    setAnchorPoint({ x: point.x, y: point.y });
  }, [path, anchorT]);

  const labelX = anchorPoint.x + offsetX;
  const labelY = anchorPoint.y + offsetY;

  // Drag state lives in a ref + document-level listeners, NOT React state
  // or element-level pointer capture. The label's position updates on every
  // pointermove via onUpdateEdge, which re-renders this component - if the
  // drag were tracked via setPointerCapture on the label div itself (the
  // previous approach), there's a real risk of that capture not reliably
  // surviving the rapid re-renders a continuous drag triggers. Document
  // listeners sidestep that entirely: they're attached to an element that
  // never re-renders or unmounts.
  const onLabelPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onUpdateEdge) return;
      event.stopPropagation();
      event.preventDefault();

      let moved = false;
      const startClientX = event.clientX;
      const startClientY = event.clientY;

      const handleMove = (moveEvent: PointerEvent) => {
        const pathEl = measurePathRef.current;
        if (!pathEl) return;

        if (!moved) {
          const dx = moveEvent.clientX - startClientX;
          const dy = moveEvent.clientY - startClientY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          moved = true;
        }

        const flowPoint = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        const closest = findClosestPointOnPath(pathEl, flowPoint.x, flowPoint.y);
        onUpdateEdge(id, {
          labelAnchorT: closest.t,
          labelOffsetX: flowPoint.x - closest.x,
          labelOffsetY: flowPoint.y - closest.y,
        });
      };

      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    },
    [id, onUpdateEdge, screenToFlowPosition]
  );

  const onLabelDoubleClick = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onUpdateEdge) return;
      event.stopPropagation();
      onUpdateEdge(id, { labelAnchorT: undefined, labelOffsetX: undefined, labelOffsetY: undefined });
    },
    [id, onUpdateEdge]
  );

  const shownLabel = data?.hideLabel ? "" : data?.label?.trim() ? data.label : def.label;
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
          stroke: color,
          strokeWidth: selected || isFocused ? 2.5 : 1.75,
          strokeDasharray: animated ? def.dash ?? FLOW_FALLBACK_DASH : def.dash,
          opacity,
          filter: isFocused ? `drop-shadow(0 0 5px ${color})` : undefined,
        }}
      />

      <path ref={measurePathRef} d={path} fill="none" stroke="none" style={{ opacity: 0, pointerEvents: "none" }} />

      {selected && onUpdateEdge && (
        <EdgeLabelRenderer>
          <div
            className="typed-edge__anchor-dot"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${anchorPoint.x}px, ${anchorPoint.y}px)`,
            }}
            title="Where this label is anchored on the line"
          />
        </EdgeLabelRenderer>
      )}

      {shownLabel && (
        <EdgeLabelRenderer>
          <div
            className={`typed-edge__label nodrag nopan nowheel${selected ? " is-selected" : ""}`}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: color,
              color,
              opacity,
              boxShadow: isFocused ? `0 0 8px ${color}99` : undefined,
            }}
            onPointerDown={onLabelPointerDown}
            onDoubleClick={onLabelDoubleClick}
            title={onUpdateEdge ? "Drag to reposition, double-click to re-center" : undefined}
          >
            {shownLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
