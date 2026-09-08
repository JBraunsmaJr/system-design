import { Position } from "@xyflow/react";

/**
 * Which end of an edge (if either) is a boundary that CONTAINS the other
 * end.
 *
 *   "none"          - an ordinary edge between unrelated nodes
 *   "target-inside" - the source is a boundary and the target sits inside it
 *   "source-inside" - the target is a boundary and the source sits inside it
 */
export type ContainmentRelation = "none" | "target-inside" | "source-inside";

/**
 * Whether `nodeId` sits inside `ancestorId`, at any depth.
 *
 * Walks the parent chain rather than checking one level, because groups
 * nest: an edge from an outer boundary to a component two levels down is
 * the same modelling idea as one to a direct child, and it routes just as
 * badly if only direct children are recognised.
 *
 * The visited set guards against a corrupted parent chain forming a
 * cycle. That should be impossible, but this runs inside edge rendering
 * for every edge on every relevant change, and an infinite loop there
 * would hang the canvas rather than merely drawing something wrong.
 */
export function isInside(
  nodeId: string,
  ancestorId: string,
  parentOf: (id: string) => string | undefined
): boolean {
  const visited = new Set<string>([nodeId]);
  let current = parentOf(nodeId);
  while (current !== undefined) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = parentOf(current);
  }
  return false;
}

/** Classifies an edge's two endpoints by containment. */
export function getContainmentRelation(
  sourceId: string,
  targetId: string,
  parentOf: (id: string) => string | undefined
): ContainmentRelation {
  if (sourceId === targetId) return "none";
  if (isInside(targetId, sourceId, parentOf)) return "target-inside";
  if (isInside(sourceId, targetId, parentOf)) return "source-inside";
  return "none";
}

/** The opposite side of a node from the one given. */
export function flipPosition(position: Position): Position {
  switch (position) {
    case Position.Left:
      return Position.Right;
    case Position.Right:
      return Position.Left;
    case Position.Top:
      return Position.Bottom;
    case Position.Bottom:
      return Position.Top;
    default:
      return position;
  }
}

/**
 * The Positions to route a smooth-step path with, given how the two ends
 * are related.
 *
 * A handle's Position tells the router which way to leave the node: a
 * handle on a boundary's left edge extends its first segment leftwards,
 * away from the boundary. That is right for an ordinary edge and wrong
 * for one drawn from a boundary to something INSIDE it - the path leaves
 * the boundary, travels around the outside, and re-enters to reach a
 * target that was never outside in the first place. The picture that
 * results reads as traffic leaving and coming back, which is the
 * opposite of the containment being described.
 *
 * Flipping the boundary end's Position makes that first segment head
 * inward instead, so the path stays within the boundary. Only the
 * boundary end is flipped; the contained node keeps its own handle
 * orientation, because it genuinely is being approached from that side.
 */
export function getContainmentAwarePositions(
  relation: ContainmentRelation,
  sourcePosition: Position,
  targetPosition: Position
): { sourcePosition: Position; targetPosition: Position } {
  switch (relation) {
    case "target-inside":
      return { sourcePosition: flipPosition(sourcePosition), targetPosition };
    case "source-inside":
      return { sourcePosition, targetPosition: flipPosition(targetPosition) };
    default:
      return { sourcePosition, targetPosition };
  }
}

/**
 * How far the invisible click band is pulled back from a boundary's own
 * connector.
 *
 * A handle is 8px plus a 2px border on each side, so it occupies roughly
 * 6px either side of the border line it sits on. 14px clears that with
 * margin while still leaving the band covering all but the very tip of
 * the edge.
 */
export const HANDLE_CLEARANCE = 14;

/** Unit vector for the direction a handle on this side points. */
function positionDelta(position: Position): { dx: number; dy: number } {
  switch (position) {
    case Position.Left:
      return { dx: -1, dy: 0 };
    case Position.Right:
      return { dx: 1, dy: 0 };
    case Position.Top:
      return { dx: 0, dy: -1 };
    default:
      return { dx: 0, dy: 1 };
  }
}

/**
 * Endpoints for the edge's invisible CLICK band - not for the visible
 * line, which still runs all the way to the handle.
 *
 * React Flow draws a 20px-wide transparent stroke over every edge so it
 * can be clicked, and that band ends exactly on the endpoint. When the
 * endpoint is a boundary's own connector, the band therefore covers it.
 * The edge also paints above the boundary (React Flow gives an edge the
 * z-index of whichever end has a parent, and a child always outranks its
 * parent), so the band wins the hit test and the connector cannot be
 * grabbed to start a new edge at all.
 *
 * Pulling just the band's boundary end inward leaves the connector free
 * while keeping the edge itself clickable along its whole length bar the
 * last few pixels. The visible geometry is untouched.
 *
 * `inward` is the already-flipped Position from
 * getContainmentAwarePositions - the direction the path leaves the
 * boundary - so the band retreats along the line rather than sideways
 * off it.
 */
export function getClickBandEndpoints(
  relation: ContainmentRelation,
  points: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  inward: { sourcePosition: Position; targetPosition: Position }
): { sourceX: number; sourceY: number; targetX: number; targetY: number } {
  if (relation === "target-inside") {
    const { dx, dy } = positionDelta(inward.sourcePosition);
    return {
      ...points,
      sourceX: points.sourceX + dx * HANDLE_CLEARANCE,
      sourceY: points.sourceY + dy * HANDLE_CLEARANCE,
    };
  }
  if (relation === "source-inside") {
    const { dx, dy } = positionDelta(inward.targetPosition);
    return {
      ...points,
      targetX: points.targetX + dx * HANDLE_CLEARANCE,
      targetY: points.targetY + dy * HANDLE_CLEARANCE,
    };
  }
  return points;
}
