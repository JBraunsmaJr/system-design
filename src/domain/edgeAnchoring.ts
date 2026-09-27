/**
 * Where a connection drag should actually land.
 *
 * Nodes no longer show connector dots. Instead every side of a node is a
 * grab strip (see EdgeHandles.tsx): pressing on a node's border and
 * dragging starts a connection, and on release the edge attaches to
 * whichever node is under the pointer, on:
 *
 *   1. the side the pointer was released on, if it was released on a
 *      border, or
 *   2. the side closest to the pointer, if it was released over the
 *      node's body.
 *
 * Both rules collapse into one - "the side of the node's box nearest the
 * pointer" - because a pointer resting on a border is by definition
 * nearest that border. What differs is only whether a node is eligible
 * at all (see resolveDropTarget).
 *
 * Kept free of React Flow types so it can be exercised directly by
 * edgeAnchoring.verify.ts; the adapter that reads React Flow's internal
 * node geometry lives in components/edges/edgeAnchoringAdapter.ts.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One place an edge can attach to on a node. `pointId` is the suffix of
 * the node's handle ids - the edge stores `source-${pointId}` /
 * `target-${pointId}` exactly as it always has, so existing diagrams keep
 * attaching to the same spots.
 */
export interface Anchor {
  pointId: string;
  side: Side;
  /** Absolute (flow-space) position of the anchor. */
  x: number;
  y: number;
}

export interface DropCandidate {
  id: string;
  rect: Rect;
  /** Boundaries have click-through interiors, so only their border counts. */
  isGroup: boolean;
  anchors: Anchor[];
}

export interface DropTarget {
  nodeId: string;
  side: Side;
  anchor: Anchor;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function sideSegment(rect: Rect, side: Side): [Point, Point] {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  switch (side) {
    case 'top':
      return [
        { x: left, y: top },
        { x: right, y: top },
      ];
    case 'right':
      return [
        { x: right, y: top },
        { x: right, y: bottom },
      ];
    case 'bottom':
      return [
        { x: left, y: bottom },
        { x: right, y: bottom },
      ];
    case 'left':
      return [
        { x: left, y: top },
        { x: left, y: bottom },
      ];
  }
}

export function distanceToSide(rect: Rect, side: Side, p: Point): number {
  const [a, b] = sideSegment(rect, side);
  return distanceToSegment(p, a, b);
}

/** The side of `rect` nearest to `p`, from inside or outside the box.
 * Ties (exact corners, the exact centre of a square) resolve in SIDES
 * order so the result is deterministic. */
export function closestSide(rect: Rect, p: Point): Side {
  let best: Side = 'top';
  let bestDistance = Infinity;
  for (const side of SIDES) {
    const d = distanceToSide(rect, side, p);
    if (d < bestDistance) {
      best = side;
      bestDistance = d;
    }
  }
  return best;
}

export function distanceToBorder(rect: Rect, p: Point): number {
  return Math.min(...SIDES.map((side) => distanceToSide(rect, side, p)));
}

export function isInside(rect: Rect, p: Point): boolean {
  return p.x > rect.x && p.x < rect.x + rect.width && p.y > rect.y && p.y < rect.y + rect.height;
}

/**
 * The anchor to use on a given side: the one on that side nearest `p`.
 * Plain nodes only have one anchor per side so this is just a lookup;
 * shapes with custom connection points (e.g. 8-way) can have several on
 * a side, and nearest-to-pointer picks the one the drag is heading for.
 * Falls back to the nearest anchor overall if nothing sits on that side.
 */
export function pickAnchor(anchors: readonly Anchor[], side: Side, p: Point): Anchor | null {
  const onSide = anchors.filter((a) => a.side === side);
  const pool = onSide.length > 0 ? onSide : anchors;
  let best: Anchor | null = null;
  let bestDistance = Infinity;
  for (const anchor of pool) {
    const d = Math.hypot(anchor.x - p.x, anchor.y - p.y);
    if (d < bestDistance) {
      best = anchor;
      bestDistance = d;
    }
  }
  return best;
}

export interface ResolveOptions {
  /** How far outside/inside a border (flow units) still counts as "on" it. */
  borderTolerance: number;
  /**
   * The node the drag is anchored to (where a new connection started, or
   * the end of an edge that isn't being moved) and the side it's on.
   * Releasing back over that node's body is treated as a cancel rather
   * than a self-loop - otherwise a press on a border that drifts a few
   * pixels inward would silently create one. A self-loop is still
   * possible by releasing on a DIFFERENT side's border.
   */
  anchoredNodeId?: string | null;
  anchoredSide?: Side | null;
}

/**
 * Which node, side and anchor a release at `p` should connect to, or
 * null if it shouldn't connect to anything.
 *
 * Eligibility:
 *  - regular nodes: anywhere over their body, or within tolerance of a border
 *  - boundaries (groups): only within tolerance of their border, matching
 *    how their interior is click-through everywhere else in the canvas
 *  - the anchored node itself: only on the border of a different side
 *
 * When several are eligible (a node inside a boundary, overlapping nodes)
 * regular nodes beat boundaries, then the smallest box wins - the most
 * specific thing under the pointer.
 */
export function resolveDropTarget(
  p: Point,
  candidates: readonly DropCandidate[],
  options: ResolveOptions,
): DropTarget | null {
  const { borderTolerance, anchoredNodeId, anchoredSide } = options;

  let best: { candidate: DropCandidate; side: Side; area: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.anchors.length === 0) continue;
    const { rect } = candidate;
    if (rect.width <= 0 || rect.height <= 0) continue;

    const onBorder = distanceToBorder(rect, p) <= borderTolerance;
    const side = closestSide(rect, p);

    let eligible: boolean;
    if (candidate.id === anchoredNodeId) {
      eligible = onBorder && side !== anchoredSide;
    } else if (candidate.isGroup) {
      eligible = onBorder;
    } else {
      eligible = onBorder || isInside(rect, p);
    }
    if (!eligible) continue;

    const area = rect.width * rect.height;
    if (
      !best ||
      (best.candidate.isGroup && !candidate.isGroup) ||
      (best.candidate.isGroup === candidate.isGroup && area < best.area)
    ) {
      best = { candidate, side, area };
    }
  }

  if (!best) return null;
  const anchor = pickAnchor(best.candidate.anchors, best.side, p);
  if (!anchor) return null;
  return { nodeId: best.candidate.id, side: best.side, anchor };
}

export const sourceHandleId = (pointId: string) => `source-${pointId}`;
export const targetHandleId = (pointId: string) => `target-${pointId}`;

/** `grab-top` etc. - the strip handles that START a connection. They are
 * never stored on an edge. */
export const GRAB_HANDLE_PREFIX = 'grab-';
export const grabHandleId = (side: Side) => `${GRAB_HANDLE_PREFIX}${side}`;

export function sideFromGrabHandleId(id: string | null | undefined): Side | null {
  if (!id || !id.startsWith(GRAB_HANDLE_PREFIX)) return null;
  const side = id.slice(GRAB_HANDLE_PREFIX.length);
  return (SIDES as readonly string[]).includes(side) ? (side as Side) : null;
}
