/**
 * Verification for the waypoint routing geometry.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/edgeRouting.verify.ts
 */
import { Position } from "@xyflow/react";
import {
  buildOrthogonalRoute,
  simplifyOrthogonalPoints,
  roundedPolylinePath,
  getSegmentInsertions,
  polylineMidpoint,
  snapWaypoint,
  getWaypointNeighbours,
  createWaypointId,
  type Point,
} from "./edgeRouting";
import type { EdgeWaypoint } from "./types";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

function isAxisAligned(a: Point, b: Point): boolean {
  return a.x === b.x || a.y === b.y;
}

function everySegmentOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (!isAxisAligned(points[i - 1], points[i])) return false;
  }
  return true;
}

function passesThrough(points: Point[], p: Point): boolean {
  return points.some((q) => q.x === p.x && q.y === p.y);
}

// === Part 1: the route is orthogonal and actually visits every bend ===
// Both halves matter. A route that misses a waypoint is ignoring where
// the person dragged it; a route with a diagonal in it isn't the kind of
// line the rest of the diagram is drawn with.
{
  const source: Point = { x: 0, y: 0 };
  const target: Point = { x: 400, y: 200 };
  const waypoints: Point[] = [
    { x: 120, y: -80 },
    { x: 260, y: 310 },
  ];

  const route = buildOrthogonalRoute(source, Position.Right, waypoints, target, Position.Left);

  assert(everySegmentOrthogonal(route), "every segment of a routed edge is horizontal or vertical - no diagonals");
  for (const w of waypoints) {
    assert(passesThrough(route, w), `the route passes exactly through the bend at (${w.x}, ${w.y})`);
  }
  assert(
    route[0].x === source.x && route[0].y === source.y,
    "the route starts at the source handle"
  );
  const last = route[route.length - 1];
  assert(last.x === target.x && last.y === target.y, "and ends at the target handle");
}

// === Part 2: the first and last segments respect their handle's axis ===
// The last one is the one with a visible consequence beyond tidiness:
// the arrowhead is rotated to the path's final direction, so arriving on
// the wrong axis points it sideways into the node's edge.
{
  const route = buildOrthogonalRoute(
    { x: 0, y: 0 },
    Position.Right,
    [{ x: 150, y: 120 }],
    { x: 300, y: 240 },
    Position.Left
  );
  assert(route[0].y === route[1].y, "leaving a Right-facing source handle, the first segment runs horizontally");
  const [beforeLast, last] = route.slice(-2);
  assert(beforeLast.y === last.y, "arriving at a Left-facing target handle, the last segment runs horizontally");
}
{
  const route = buildOrthogonalRoute(
    { x: 0, y: 0 },
    Position.Bottom,
    [{ x: 150, y: 120 }],
    { x: 300, y: 240 },
    Position.Top
  );
  assert(route[0].x === route[1].x, "leaving a Bottom-facing source handle, the first segment runs vertically");
  const [beforeLast, last] = route.slice(-2);
  assert(beforeLast.x === last.x, "arriving at a Top-facing target handle, the last segment runs vertically");
}

// === Part 3: points that don't change the shape are dropped ===
// Rounding is applied at every interior point, so a "corner" that is
// actually mid-way along a straight run would put a visible notch in it.
{
  const simplified = simplifyOrthogonalPoints([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ]);
  assert(simplified.length === 3, `duplicate and collinear points are dropped (kept ${simplified.length} of 5)`);
  assert(
    simplified[0].x === 0 && simplified[1].x === 100 && simplified[1].y === 0 && simplified[2].y === 80,
    "and the ones kept are the genuine corners, in order"
  );

  const allSame = simplifyOrthogonalPoints([
    { x: 5, y: 5 },
    { x: 5, y: 5 },
  ]);
  assert(allSame.length === 1, "a run of identical points collapses to one rather than to none");
}

// === Part 4: a bend dragged almost on top of its neighbour ===
// Each corner rounds by up to 10px in BOTH directions, so a segment
// shorter than 20px has to reduce its radius or the two curves overlap
// and the segment turns inside out.
{
  const tight: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 6 },
    { x: 200, y: 6 },
  ];
  const d = roundedPolylinePath(tight, 10);
  const coords = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const ys = coords.filter((_, i) => i % 2 === 1);
  assert(
    ys.every((y) => y >= -0.01 && y <= 6.01),
    "corner rounding is clamped to half the shortest adjacent segment, so a 6px segment's two curves never overshoot past each other"
  );
  assert(d.startsWith("M 0,0"), "the path still starts at the first point");
  assert(d.trimEnd().endsWith("200,6"), "and still ends at the last one");
}

// === Part 5: a straight line needs no curves at all ===
{
  const d = roundedPolylinePath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    10
  );
  assert(!d.includes("Q"), `a two-point straight run produces no quadratic curves (got "${d}")`);
}

// === Part 6: insertion handles sit ON the line ===
// One handle per gap between anchors, positioned at the halfway point BY
// LENGTH of the routed line rather than the midpoint of the straight
// line between the anchors. Those differ whenever a gap is routed with
// an elbow, and the straight-line midpoint would float off beside the
// edge instead of sitting on it.
{
  const source: Point = { x: 0, y: 0 };
  const target: Point = { x: 200, y: 200 };

  const none = getSegmentInsertions(source, Position.Right, [], target, Position.Left);
  assert(none.length === 1, "an edge with no bends offers exactly one place to add one");
  assert(none[0].index === 0, "and it inserts at index 0");

  const waypoints: Point[] = [{ x: 100, y: -100 }];
  const one = getSegmentInsertions(source, Position.Right, waypoints, target, Position.Left);
  assert(one.length === 2, "an edge with one bend offers two - one either side of it");
  assert(
    one[0].index === 0 && one[1].index === 1,
    "each reporting the waypoint index a new bend dragged out of it belongs at"
  );

  const route = buildOrthogonalRoute(source, Position.Right, waypoints, target, Position.Left);
  for (const insertion of one) {
    const onSomeSegment = route.some((p, i) => {
      if (i === 0) return false;
      const a = route[i - 1];
      const within =
        insertion.x >= Math.min(a.x, p.x) - 0.01 &&
        insertion.x <= Math.max(a.x, p.x) + 0.01 &&
        insertion.y >= Math.min(a.y, p.y) - 0.01 &&
        insertion.y <= Math.max(a.y, p.y) + 0.01;
      // On an axis-aligned segment, being inside its bounding box IS
      // being on it.
      return within;
    });
    assert(onSomeSegment, `the insertion handle at (${insertion.x}, ${insertion.y}) lies on the drawn route, not off beside it`);
  }
}

// === Part 7: midpoint by arc length, not by endpoint average ===
{
  const mid = polylineMidpoint([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]);
  assert(
    mid.x === 100 && mid.y === 0,
    `the halfway point of an L is measured along the line (got ${mid.x}, ${mid.y}), which for two equal arms is the corner itself`
  );

  const degenerate = polylineMidpoint([{ x: 7, y: 9 }]);
  assert(degenerate.x === 7 && degenerate.y === 9, "a single point is its own midpoint rather than dividing by zero");
}

// === Part 8: snapping is per-axis ===
// Lining a bend up vertically with the node above it while keeping the
// height you chose is the normal case; snapping both axes at once would
// drag it onto the neighbour entirely.
{
  const neighbours: Point[] = [
    { x: 100, y: 0 },
    { x: 300, y: 400 },
  ];

  const snapped = snapWaypoint({ x: 103, y: 250 }, neighbours, 6);
  assert(snapped.x === 100, "a bend within the threshold of a neighbour's x snaps into line with it");
  assert(snapped.y === 250, "while its y is left exactly where it was dropped");

  const untouched = snapWaypoint({ x: 150, y: 250 }, neighbours, 6);
  assert(
    untouched.x === 150 && untouched.y === 250,
    "a bend outside the threshold on both axes is not moved at all - this is an assist, not a grid"
  );

  const both = snapWaypoint({ x: 302, y: 403 }, neighbours, 6);
  assert(both.x === 300 && both.y === 400, "and a bend close on both axes can still snap on both");
}

// === Part 9: which anchors a bend snaps against ===
{
  const source: Point = { x: 0, y: 0 };
  const target: Point = { x: 500, y: 500 };
  const waypoints: EdgeWaypoint[] = [
    { id: "a", x: 100, y: 100 },
    { id: "b", x: 200, y: 200 },
    { id: "c", x: 300, y: 300 },
  ];

  const first = getWaypointNeighbours(source, waypoints, target, 0);
  assert(
    first.length === 2 && first[0].x === 0 && first[1].x === 200,
    "the first bend snaps against the source handle and the bend after it"
  );

  const middle = getWaypointNeighbours(source, waypoints, target, 1);
  assert(
    middle[0].x === 100 && middle[1].x === 300,
    "a middle bend snaps against the bends either side of it"
  );

  const lastOne = getWaypointNeighbours(source, waypoints, target, 2);
  assert(
    lastOne[0].x === 200 && lastOne[1].x === 500,
    "and the last bend snaps against the bend before it and the target handle"
  );

  const only = getWaypointNeighbours(source, [{ id: "solo", x: 50, y: 50 }], target, 0);
  assert(
    only.length === 2 && only[0].x === 0 && only[1].x === 500,
    "an edge's only bend snaps against both handles"
  );
}

// === Part 10: waypoint ids don't collide ===
// Two peers inserting a bend at the same moment must not generate the
// same id, or their two bends would merge into one.
{
  const generated = new Set<string>();
  for (let i = 0; i < 2000; i++) generated.add(createWaypointId());
  assert(generated.size === 2000, `2000 generated waypoint ids are all distinct (got ${generated.size})`);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
// scripts/run-tests.ts decides pass/fail from the process exit status, so
// a failed assertion has to actually set one - printing FAIL and exiting
// 0 would report the suite as passing. Reached through globalThis
// because tsconfig.app.json doesn't include node's type definitions.
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
