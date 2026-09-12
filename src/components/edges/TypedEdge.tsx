import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  useStore,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import { getEdgeType } from "../../domain/edgeRegistry";
import {
  createWaypointId,
  getSegmentInsertions,
  getWaypointNeighbours,
  getWaypointPath,
  snapWaypoint,
  type WaypointInsertion,
} from "../../domain/edgeRouting";
import {
  getClickBandEndpoints,
  getContainmentAwarePositions,
  getContainmentRelation,
  type ContainmentRelation,
} from "../../domain/edgeContainment";
import type { ArchEdgeData, ArchEdgeDataPatch, EdgeWaypoint } from "../../domain/types";
import { useCanvasContext } from "../CanvasContext";

type TypedEdgeType = Edge<ArchEdgeData, "typed">;

interface TypedEdgeProps extends EdgeProps<TypedEdgeType> {
  onUpdateEdge?: (id: string, patch: ArchEdgeDataPatch) => void;
}

/** Below this much pointer movement, pressing on an "add a bend" handle
 * is treated as a click that changed nothing - so a stray click on the
 * line doesn't leave an invisible zero-offset bend behind. */
const INSERT_DRAG_THRESHOLD = 3;

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
  source,
  target,
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
  onUpdateEdge: propOnUpdateEdge,
}: TypedEdgeProps) {
  const canvasContext = useCanvasContext();
  const isEditable = !canvasContext?.isPresenting;
  const onUpdateEdge = isEditable ? (propOnUpdateEdge ?? canvasContext?.onUpdateEdge) : undefined;
  const onAddEdgeWaypoint = isEditable ? canvasContext?.onAddEdgeWaypoint : undefined;
  const onMoveEdgeWaypoint = isEditable ? canvasContext?.onMoveEdgeWaypoint : undefined;
  const onRemoveEdgeWaypoint = isEditable ? canvasContext?.onRemoveEdgeWaypoint : undefined;
  const canBend = Boolean(onAddEdgeWaypoint && onMoveEdgeWaypoint && onRemoveEdgeWaypoint);
  const { screenToFlowPosition } = useReactFlow();
  const def = getEdgeType(data?.edgeType ?? "generic");
  const color = data?.color ?? def.color;
  const direction = data?.direction ?? "forward";

  /**
   * Whether one end of this edge is a boundary containing the other.
   *
   * Selected as a single string rather than by pulling node objects out
   * of the store, so this component only re-renders when the ANSWER
   * changes - which is essentially never, since it changes only when a
   * node is reparented. Selecting the nodes themselves would re-run on
   * every position update of either one, for every edge on the canvas.
   */
  const containment = useStore(
    useCallback(
      (state): ContainmentRelation =>
        getContainmentRelation(source, target, (id) => state.nodeLookup.get(id)?.parentId),
      [source, target]
    )
  );

  const routed = getContainmentAwarePositions(containment, sourcePosition, targetPosition);

  const waypoints = data?.waypoints;
  const hasWaypoints = Boolean(waypoints && waypoints.length > 0);

  /**
   * An edge with no bends keeps going through React Flow's own
   * getSmoothStepPath, exactly as it always has - containment routing,
   * click band and all. The custom router only takes over once there IS
   * something to route through. Every diagram that predates waypoints
   * therefore renders through the identical code path it did before,
   * rather than through a reimplementation that merely intends to match.
   */
  const [smoothPath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition: routed.sourcePosition,
    targetX,
    targetY,
    targetPosition: routed.targetPosition,
    borderRadius: 10,
  });

  const path = hasWaypoints
    ? getWaypointPath(
        { x: sourceX, y: sourceY },
        routed.sourcePosition,
        waypoints!,
        { x: targetX, y: targetY },
        routed.targetPosition
      )
    : smoothPath;

  /**
   * A second, invisible path used only as the click target, generated
   * from endpoints pulled back from the boundary's own connector - see
   * getClickBandEndpoints. Without it React Flow's 20px click band ends
   * on top of that connector and makes it impossible to grab, because
   * an edge touching a nested node always paints above the boundary.
   *
   * Only built for containment edges; every other edge keeps React
   * Flow's default band untouched.
   */
  const clickBandPath = (() => {
    if (containment === "none") return null;
    // A bent edge no longer follows the smooth-step route this inset
    // band is derived from, so the band would sit somewhere other than
    // the line. Bends are themselves a way out of the problem the band
    // exists to solve - the person can route the edge clear of the
    // connector - so a bent containment edge just uses React Flow's own
    // band, which follows whatever path is actually drawn.
    if (hasWaypoints) return null;
    const inset = getClickBandEndpoints(containment, { sourceX, sourceY, targetX, targetY }, routed);
    const [p] = getSmoothStepPath({
      sourceX: inset.sourceX,
      sourceY: inset.sourceY,
      sourcePosition: routed.sourcePosition,
      targetX: inset.targetX,
      targetY: inset.targetY,
      targetPosition: routed.targetPosition,
      borderRadius: 10,
    });
    return p;
  })();

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
  /** Halfway along the drawn line, which is where the sole "add a bend"
   * handle goes on an edge that has none yet. Measured off the real path
   * rather than computed, because an unbent edge is drawn by
   * getSmoothStepPath and its midpoint is not necessarily the one the
   * custom router would calculate - a handle that sits a few pixels off
   * the line it belongs to looks broken. */
  const [pathMidpoint, setPathMidpoint] = useState(() => ({
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
    const mid = pathEl.getPointAtLength(totalLength * 0.5);
    setPathMidpoint({ x: mid.x, y: mid.y });
  }, [path, anchorT]);

  const labelX = anchorPoint.x + offsetX;
  const labelY = anchorPoint.y + offsetY;

  /**
   * The latest geometry, readable from inside a drag without the drag's
   * own listeners needing to be torn down and rebuilt on every render.
   * A bend being dragged snaps against its CURRENT neighbours, and those
   * move - a node at either end may be dragged at the same time, and in
   * a session a collaborator may be adding or removing other bends on
   * this same edge while this gesture is still running.
   */
  const geometryRef = useRef({ sourceX, sourceY, targetX, targetY, waypoints });
  useLayoutEffect(() => {
    geometryRef.current = { sourceX, sourceY, targetX, targetY, waypoints };
  });

  const showBendHandles = Boolean(selected && canBend);

  /** One handle per gap between anchors. An edge with no bends yet gets
   * a single one at the middle of the line, which is how you make the
   * first bend. */
  const insertions: WaypointInsertion[] = !showBendHandles
    ? []
    : hasWaypoints
      ? getSegmentInsertions(
          { x: sourceX, y: sourceY },
          routed.sourcePosition,
          waypoints!,
          { x: targetX, y: targetY },
          routed.targetPosition
        )
      : [{ index: 0, x: pathMidpoint.x, y: pathMidpoint.y }];

  /**
   * Where a bend being dragged should actually be placed.
   *
   * Resolves the waypoint's index FROM ITS ID on every single move
   * rather than capturing it when the drag began - the same discipline
   * the store operations use, and for the same reason. In a session, a
   * collaborator inserting or removing a bend earlier in this edge
   * shifts every index after theirs, and a drag holding a stale index
   * would quietly start moving the wrong bend. Returning null when the
   * id has gone covers the other half of that: a bend deleted by someone
   * else mid-gesture just stops responding, instead of the drag throwing
   * or resurrecting it.
   */
  const resolveDragPosition = useCallback(
    (waypointId: string, flowPoint: { x: number; y: number }) => {
      const geometry = geometryRef.current;
      const list: EdgeWaypoint[] = geometry.waypoints ?? [];
      const index = list.findIndex((w) => w.id === waypointId);
      if (index === -1) return null;
      const neighbours = getWaypointNeighbours(
        { x: geometry.sourceX, y: geometry.sourceY },
        list,
        { x: geometry.targetX, y: geometry.targetY },
        index
      );
      return snapWaypoint(flowPoint, neighbours);
    },
    []
  );

  const onWaypointPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, waypointId: string) => {
      if (!onMoveEdgeWaypoint) return;
      event.stopPropagation();
      event.preventDefault();

      const handleMove = (moveEvent: PointerEvent) => {
        const flowPoint = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        const next = resolveDragPosition(waypointId, flowPoint);
        if (next) onMoveEdgeWaypoint(id, waypointId, next);
      };
      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };
      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    },
    [id, onMoveEdgeWaypoint, resolveDragPosition, screenToFlowPosition]
  );

  /**
   * Dragging one of the hollow handles turns it into a real bend.
   *
   * The bend is created on the first movement past the threshold, not on
   * pointerdown - otherwise clicking an edge to select it would litter
   * the diagram with bends that sit exactly on the line and are
   * invisible until something moves.
   */
  const onInsertionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
      if (!onAddEdgeWaypoint || !onMoveEdgeWaypoint) return;
      event.stopPropagation();
      event.preventDefault();

      const startClientX = event.clientX;
      const startClientY = event.clientY;
      let createdId: string | null = null;

      const handleMove = (moveEvent: PointerEvent) => {
        const flowPoint = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        if (createdId === null) {
          const dx = moveEvent.clientX - startClientX;
          const dy = moveEvent.clientY - startClientY;
          if (Math.hypot(dx, dy) < INSERT_DRAG_THRESHOLD) return;
          createdId = createWaypointId();
          onAddEdgeWaypoint(id, index, { id: createdId, x: flowPoint.x, y: flowPoint.y });
          return;
        }
        const next = resolveDragPosition(createdId, flowPoint);
        if (next) onMoveEdgeWaypoint(id, createdId, next);
      };
      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };
      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    },
    [id, onAddEdgeWaypoint, onMoveEdgeWaypoint, resolveDragPosition, screenToFlowPosition]
  );

  const onWaypointDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, waypointId: string) => {
      if (!onRemoveEdgeWaypoint) return;
      event.stopPropagation();
      onRemoveEdgeWaypoint(id, waypointId);
    },
    [id, onRemoveEdgeWaypoint]
  );

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
  const isStepMember = data?.isStepMember === true;
  const isStepCandidate = selected && data?.isStepMember === false;
  const flowClass = animated ? ` typed-edge--flow-${direction}` : "";

  return (
    <>
      {/* Replaces BaseEdge's own click band when one is supplied below,
          so the two don't overlap and re-cover the connector. */}
      {clickBandPath && (
        <path
          d={clickBandPath}
          fill="none"
          strokeOpacity={0}
          strokeWidth={20}
          className="react-flow__edge-interaction"
        />
      )}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={clickBandPath ? 0 : undefined}
        // Which end(s) get an arrowhead. "reverse" moves the single
        // arrowhead to the source end, indicating the real traffic runs
        // opposite to how the edge happens to be drawn; "both" keeps one
        // at each end for a genuinely bi-directional relationship.
        markerEnd={direction === "reverse" ? undefined : markerEnd}
        markerStart={direction === "reverse" || direction === "both" ? markerStart : undefined}
        className={`typed-edge${flowClass}`}
        style={{
          stroke: isStepCandidate ? "#fbbf24" : color,
          strokeWidth: selected || isFocused || isStepMember || isStepCandidate ? 2.5 : 1.75,
          strokeDasharray: isStepCandidate ? "6 4" : animated ? def.dash ?? FLOW_FALLBACK_DASH : def.dash,
          opacity,
          filter: isFocused
            ? `drop-shadow(0 0 5px ${color})`
            : isStepMember || isStepCandidate
              ? "drop-shadow(0 0 5px #fbbf24)"
              : undefined,
        }}
      />

      <path ref={measurePathRef} d={path} fill="none" stroke="none" style={{ opacity: 0, pointerEvents: "none" }} />

      {showBendHandles && (
        <EdgeLabelRenderer>
          {insertions.map((insertion) => (
            <div
              key={`insert-${insertion.index}`}
              className="typed-edge__insert-dot nodrag nopan nowheel"
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${insertion.x}px, ${insertion.y}px)`,
              }}
              onPointerDown={(event) => onInsertionPointerDown(event, insertion.index)}
              title="Drag to bend this edge"
            />
          ))}
          {(waypoints ?? []).map((waypoint) => (
            <div
              key={waypoint.id}
              className="typed-edge__waypoint nodrag nopan nowheel"
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${waypoint.x}px, ${waypoint.y}px)`,
              }}
              onPointerDown={(event) => onWaypointPointerDown(event, waypoint.id)}
              onDoubleClick={(event) => onWaypointDoubleClick(event, waypoint.id)}
              title="Drag to move this bend, double-click to remove it"
            />
          ))}
        </EdgeLabelRenderer>
      )}

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
              borderColor: isStepMember ? "var(--accent)" : isStepCandidate ? "#fbbf24" : color,
              color,
              opacity,
              boxShadow: isFocused
                ? `0 0 8px ${color}99`
                : isStepMember
                  ? "0 0 0 2px var(--accent)"
                  : isStepCandidate
                    ? "0 0 0 2px #fbbf24"
                    : undefined,
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
