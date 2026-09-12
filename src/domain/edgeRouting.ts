import { Position } from "@xyflow/react";
import type { EdgeWaypoint } from "./types";

/**
 * Orthogonal routing through user-placed waypoints - the geometry half
 * of draw.io-style edge manipulation (dragging the line itself to bend
 * it), kept out of TypedEdge.tsx so it can be verified on its own
 * without a DOM, the same way edgeContainment.ts is.
 *
 * This module is only used once an edge actually HAS waypoints. An edge
 * with none keeps going through React Flow's own getSmoothStepPath
 * exactly as before, containment routing and click band included - the
 * existing behaviour is untouched rather than reimplemented here and
 * hoped to match.
 */

export interface Point {
  x: number;
  y: number;
}

/** Default corner rounding, matching the borderRadius TypedEdge already
 * passes to getSmoothStepPath so a bent edge and a straight one look
 * like the same kind of line. */
export const CORNER_RADIUS = 10;

/** How close (in flow units) a dragged waypoint has to come to lining up
 * with one of its neighbours before it snaps into alignment with it.
 * Small on purpose: this is an assist for the common case of wanting a
 * genuinely straight run, not a grid you have to fight. */
export const WAYPOINT_SNAP_THRESHOLD = 6;

/** Waypoint ids exist for CRDT reasons rather than display ones - see
 * DiagramStore.moveEdgeWaypoint - so, same reasoning as
 * yjsDiagramStore's own collisionResistantId, they're made
 * collision-resistant from the start. Two peers inserting a bend at the
 * same moment must not generate the same id, or their two bends would
 * merge into one. */
export function createWaypointId(): string {
  return `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isHorizontal(position: Position): boolean {
  return position === Position.Left || position === Position.Right;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** The point `dist` along the way from `from` towards `to`. */
function pointTowards(from: Point, to: Point, dist: number): Point {
  const length = distance(from, to);
  if (length === 0) return { x: from.x, y: from.y };
  const t = dist / length;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

type Axis = "h" | "v";

function perpendicular(axis: Axis): Axis {
  return axis === "h" ? "v" : "h";
}

function axisOf(position: Position): Axis {
  return isHorizontal(position) ? "h" : "v";
}

/**
 * The orthogonal points needed to get from `a` to `b`, leaving `a` along
 * the `leave` axis and arriving at `b` along the `arrive` axis.
 *
 * When those two axes are perpendicular, one corner does it - the
 * familiar L. When they're the SAME axis, one corner cannot: an L would
 * have to arrive on the wrong axis. That case needs three segments (a Z)
 * with a corner either side of the halfway line.
 *
 * Getting this wrong is not a cosmetic matter, which is why it's a
 * distinct case rather than a fallback. Forcing an L where a Z is needed
 * makes the route double back along the line it arrived on - and a
 * segment that reverses on itself is collinear, so simplification then
 * quite correctly deletes the very bend the person had just dragged
 * there. The line ends up ignoring the waypoint entirely.
 */
function routePair(a: Point, b: Point, leave: Axis, arrive: Axis): Point[] {
  if (leave !== arrive) {
    if (a.x === b.x || a.y === b.y) return [b];
    return leave === "h" ? [{ x: b.x, y: a.y }, b] : [{ x: a.x, y: b.y }, b];
  }
  if (leave === "h") {
    if (a.y === b.y) return [b];
    const midX = (a.x + b.x) / 2;
    return [
      { x: midX, y: a.y },
      { x: midX, y: b.y },
      b,
    ];
  }
  if (a.x === b.x) return [b];
  const midY = (a.y + b.y) / 2;
  return [
    { x: a.x, y: midY },
    { x: b.x, y: midY },
    b,
  ];
}

/**
 * The axes to leave and arrive on for the pair of anchors at `index`.
 *
 * The first pair leaves along the source handle's own axis and the last
 * arrives along the target handle's, for the reasons in
 * buildOrthogonalRoute. Every pair in between arrives on the axis
 * perpendicular to the one it left on, which is what turns each waypoint
 * into an actual corner rather than a point the line reverses at. That
 * rule also means the leave axis never changes from pair to pair, so
 * there's no state to thread through the loop.
 */
function pairAxes(index: number, pairCount: number, sourceAxis: Axis, targetAxis: Axis): { leave: Axis; arrive: Axis } {
  const isLastPair = index === pairCount - 1;
  return {
    leave: sourceAxis,
    arrive: isLastPair ? targetAxis : perpendicular(sourceAxis),
  };
}

/**
 * Drops points that don't change the shape of the line: exact
 * duplicates, and any middle point that sits on the straight run between
 * its two neighbours.
 *
 * Worth doing before rounding rather than after: a corner radius applied
 * at a point that isn't actually a corner produces a visible notch in
 * what should be a straight segment.
 */
export function simplifyOrthogonalPoints(points: readonly Point[]): Point[] {
  const deduped: Point[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (!last || !samePoint(last, p)) deduped.push({ x: p.x, y: p.y });
  }

  const result: Point[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const prev = result[result.length - 1];
    const current = deduped[i];
    const next = deduped[i + 1];
    if (prev && next) {
      const flatX = prev.x === current.x && current.x === next.x;
      const flatY = prev.y === current.y && current.y === next.y;
      if (flatX || flatY) continue;
    }
    result.push(current);
  }
  return result;
}

/**
 * The full orthogonal point chain from the source handle, through every
 * waypoint in order, to the target handle.
 *
 * Two rules decide the elbows:
 *
 *  - The first segment leaves along the axis the SOURCE handle faces. A
 *    handle on a node's right side has to start by going right; starting
 *    vertically would put the line's first run flush against the node's
 *    own side.
 *
 *  - The last segment arrives along the axis the TARGET handle faces,
 *    for the same reason plus one more: the arrowhead is rotated to the
 *    path's final direction, so arriving on the wrong axis points it
 *    sideways into the node's edge rather than at it.
 *
 * Everything in between just continues on the source's axis, which keeps
 * the shape predictable while dragging - the point of a waypoint is that
 * YOU decide where the line goes, so the router's job here is to be
 * boring and do what it did last frame, not to be clever.
 */
export function buildOrthogonalRoute(
  source: Point,
  sourcePosition: Position,
  waypoints: readonly Point[],
  target: Point,
  targetPosition: Position
): Point[] {
  const anchors: Point[] = [source, ...waypoints, target];
  const route: Point[] = [source];
  const sourceAxis = axisOf(sourcePosition);
  const targetAxis = axisOf(targetPosition);
  const pairCount = anchors.length - 1;

  for (let i = 0; i < pairCount; i++) {
    const { leave, arrive } = pairAxes(i, pairCount, sourceAxis, targetAxis);
    route.push(...routePair(anchors[i], anchors[i + 1], leave, arrive));
  }

  return simplifyOrthogonalPoints(route);
}

/**
 * An SVG path through the given points with rounded corners.
 *
 * Each corner's radius is clamped to half of the shorter of its two
 * adjacent segments, so dragging a waypoint until it nearly touches its
 * neighbour degrades into a sharp corner instead of the two rounded
 * corners overlapping and turning the segment inside out.
 */
export function roundedPolylinePath(points: readonly Point[], radius: number = CORNER_RADIUS): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${fmt(points[0].x)},${fmt(points[0].y)}`;

  let d = `M ${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const r = Math.min(radius, distance(prev, corner) / 2, distance(corner, next) / 2);
    if (r <= 0) {
      d += ` L ${fmt(corner.x)},${fmt(corner.y)}`;
      continue;
    }
    const entry = pointTowards(corner, prev, r);
    const exit = pointTowards(corner, next, r);
    d += ` L ${fmt(entry.x)},${fmt(entry.y)} Q ${fmt(corner.x)},${fmt(corner.y)} ${fmt(exit.x)},${fmt(exit.y)}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${fmt(last.x)},${fmt(last.y)}`;
}

/** Convenience wrapper - the whole route as a single drawable path. */
export function getWaypointPath(
  source: Point,
  sourcePosition: Position,
  waypoints: readonly Point[],
  target: Point,
  targetPosition: Position,
  radius: number = CORNER_RADIUS
): string {
  return roundedPolylinePath(
    buildOrthogonalRoute(source, sourcePosition, waypoints, target, targetPosition),
    radius
  );
}

/** Where an "add a bend here" handle goes, and the waypoint index a bend
 * dragged out of it should be inserted at. */
export interface WaypointInsertion {
  /** Index in the edge's own waypoints array, NOT in the routed
   * point chain - the chain contains generated elbow corners that
   * aren't waypoints and have no index of their own. */
  index: number;
  x: number;
  y: number;
}

/**
 * One insertion handle per gap between consecutive anchors (source, each
 * waypoint, target) - so an edge with no bends offers one, an edge with
 * two bends offers three.
 *
 * Each handle sits at the halfway point BY LENGTH of the routed line
 * between its two anchors, not at the midpoint of the straight line
 * between them. Those are different points whenever the gap is routed
 * with an elbow, and the straight-line midpoint would float off in space
 * beside the edge rather than sitting on it.
 */
export function getSegmentInsertions(
  source: Point,
  sourcePosition: Position,
  waypoints: readonly Point[],
  target: Point,
  targetPosition: Position
): WaypointInsertion[] {
  const anchors: Point[] = [source, ...waypoints, target];
  const sourceAxis = axisOf(sourcePosition);
  const targetAxis = axisOf(targetPosition);
  const pairCount = anchors.length - 1;
  const insertions: WaypointInsertion[] = [];

  for (let i = 0; i < pairCount; i++) {
    // Routed with the exact same rules the drawn path uses, so a handle
    // can't drift off the line it's supposed to sit on.
    const { leave, arrive } = pairAxes(i, pairCount, sourceAxis, targetAxis);
    const subRoute = simplifyOrthogonalPoints([anchors[i], ...routePair(anchors[i], anchors[i + 1], leave, arrive)]);
    const mid = polylineMidpoint(subRoute);
    insertions.push({ index: i, x: mid.x, y: mid.y });
  }
  return insertions;
}

/** The point halfway along a polyline measured by arc length. */
export function polylineMidpoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  if (total === 0) return { x: points[0].x, y: points[0].y };

  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    const segment = distance(points[i - 1], points[i]);
    if (segment >= remaining) {
      return pointTowards(points[i - 1], points[i], remaining);
    }
    remaining -= segment;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * Pulls a dragged waypoint into line with a neighbour when it comes
 * close enough, per axis independently.
 *
 * Independently matters: dropping a bend so it lines up vertically with
 * the node above it while sitting at whatever height you chose is the
 * normal case, and snapping both axes together would drag it onto the
 * neighbour entirely.
 */
export function snapWaypoint(
  point: Point,
  neighbours: readonly Point[],
  threshold: number = WAYPOINT_SNAP_THRESHOLD
): Point {
  let x = point.x;
  let y = point.y;
  let snappedX = false;
  let snappedY = false;
  for (const neighbour of neighbours) {
    if (!snappedX && Math.abs(point.x - neighbour.x) <= threshold) {
      x = neighbour.x;
      snappedX = true;
    }
    if (!snappedY && Math.abs(point.y - neighbour.y) <= threshold) {
      y = neighbour.y;
      snappedY = true;
    }
  }
  return { x, y };
}

/** The two anchors either side of the waypoint at `index` - what
 * snapWaypoint should line that waypoint up against while it's dragged. */
export function getWaypointNeighbours(
  source: Point,
  waypoints: readonly EdgeWaypoint[],
  target: Point,
  index: number
): Point[] {
  const before = index === 0 ? source : waypoints[index - 1];
  const after = index === waypoints.length - 1 ? target : waypoints[index + 1];
  return [before, after].filter((p): p is Point => p !== undefined).map((p) => ({ x: p.x, y: p.y }));
}

/** Trims coordinates to 2dp. Keeps path strings short, and stops a
 * sub-pixel difference in a float from counting as a changed `d`
 * attribute and invalidating TypedEdge's own path-keyed effects. */
function fmt(value: number): number {
  return Math.round(value * 100) / 100;
}
