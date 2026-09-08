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
