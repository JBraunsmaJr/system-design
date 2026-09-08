/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/edgeContainment.verify.ts
 */
import { Position, getSmoothStepPath } from "@xyflow/react";
import {
  isInside,
  getContainmentRelation,
  flipPosition,
  getContainmentAwarePositions,
  getClickBandEndpoints,
  HANDLE_CLEARANCE,
} from "./edgeContainment";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

/** Builds a parentOf lookup from a plain child -> parent map. */
function tree(parents: Record<string, string>) {
  return (id: string) => parents[id];
}

// A boundary containing a component, plus an unrelated node outside it.
const simple = tree({ api: "boundary", db: "boundary" });

// === Part 1: direct containment is recognised from both directions ===
{
  assert(isInside("api", "boundary", simple), "a direct child is inside its boundary");
  assert(!isInside("boundary", "api", simple), "and the boundary is not inside its own child");
  assert(!isInside("outsider", "boundary", simple), "a node with no parent is inside nothing");
}

// === Part 2: nesting to any depth ===
// An edge from an outer boundary to a component two levels down is the
// same modelling idea as one to a direct child, and routes just as badly
// if only direct children are recognised.
{
  const nested = tree({ handler: "service", service: "zone", zone: "region" });

  assert(isInside("handler", "region", nested), "containment is transitive - a deeply nested node is inside every boundary above it");
  assert(isInside("service", "region", nested), "as is an intermediate one");
  assert(!isInside("region", "handler", nested), "and the relation stays one-directional at depth");
}

// === Part 3: a corrupted parent chain terminates ===
// Should be impossible, but this runs during edge rendering for every
// edge - a cycle here would hang the canvas rather than just drawing
// something wrong.
{
  const cyclic = tree({ a: "b", b: "c", c: "a" });

  assert(isInside("a", "c", cyclic) === true, "a real ancestor is still found in a cyclic chain");
  assert(isInside("a", "nowhere", cyclic) === false, "and walking a cycle looking for a node that isn't there terminates instead of looping forever");
}

// === Part 4: classifying an edge's two ends ===
{
  assert(getContainmentRelation("boundary", "api", simple) === "target-inside", "boundary -> contained node is classified as target-inside");
  assert(getContainmentRelation("api", "boundary", simple) === "source-inside", "contained node -> boundary is classified as source-inside");
  assert(getContainmentRelation("api", "db", simple) === "none", "two siblings inside the same boundary are unrelated - neither contains the other");
  assert(getContainmentRelation("api", "outsider", simple) === "none", "an edge to something outside the boundary is an ordinary edge");
  assert(getContainmentRelation("boundary", "boundary", simple) === "none", "a self-edge is not containment");
}

// === Part 5: flipping a side ===
{
  assert(flipPosition(Position.Left) === Position.Right, "left flips to right");
  assert(flipPosition(Position.Right) === Position.Left, "right flips to left");
  assert(flipPosition(Position.Top) === Position.Bottom, "top flips to bottom");
  assert(flipPosition(Position.Bottom) === Position.Top, "bottom flips to top");
}

// === Part 6: the reported bug - boundary out to a node inside it ===
// A handle on the boundary's left edge extends its first segment
// leftwards, AWAY from the boundary, so the path leaves, travels around
// the outside and re-enters to reach a target that was never outside.
// Flipping the boundary end sends that segment inward instead.
{
  const routed = getContainmentAwarePositions("target-inside", Position.Left, Position.Left);

  assert(routed.sourcePosition === Position.Right, "the boundary end is flipped so the path heads INTO the boundary rather than out of it");
  assert(routed.targetPosition === Position.Left, "the contained node keeps its own handle side - it really is approached from that side");
}

// === Part 7: the reverse direction, egress from inside ===
{
  const routed = getContainmentAwarePositions("source-inside", Position.Right, Position.Right);

  assert(routed.targetPosition === Position.Left, "when the boundary is the TARGET, its end is the one flipped");
  assert(routed.sourcePosition === Position.Right, "and the contained node is left alone");
}

// === Part 8: ordinary edges are untouched ===
// The fix must not alter routing for the overwhelmingly common case of
// an edge between two unrelated nodes.
{
  const routed = getContainmentAwarePositions("none", Position.Bottom, Position.Top);

  assert(routed.sourcePosition === Position.Bottom && routed.targetPosition === Position.Top, "an edge between unrelated nodes routes exactly as before");
}

// === Part 9: only ONE end is ever flipped ===
// Flipping both would send the contained node's stub outward through the
// boundary wall, trading one wrong-looking path for another.
{
  for (const relation of ["target-inside", "source-inside"] as const) {
    const routed = getContainmentAwarePositions(relation, Position.Top, Position.Top);
    const flipped = [routed.sourcePosition !== Position.Top, routed.targetPosition !== Position.Top].filter(Boolean);
    assert(flipped.length === 1, `${relation}: exactly one end is flipped, never both`);
  }
}

// === Part 10: the actual path geometry stays inside the boundary ===
// The assertions above check the routing DECISION; this checks the
// result. getSmoothStepPath is the real router the canvas uses, so this
// catches the case where flipping is applied correctly and the path
// still escapes.
//
// The bounds come from the coordinates in the emitted path data, which
// includes Bezier control points - so it's a slight over-estimate of the
// drawn curve, and therefore a conservative test.
{
  const boundary = { x: 0, y: 0, width: 600, height: 400 };
  const inside = { x: 400, y: 210 };

  function pathBounds(sp: Position, sx: number, sy: number) {
    const [path] = getSmoothStepPath({
      sourceX: sx, sourceY: sy, sourcePosition: sp,
      targetX: inside.x, targetY: inside.y, targetPosition: Position.Left,
      borderRadius: 10,
    });
    const nums = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) { xs.push(nums[i]); ys.push(nums[i + 1]); }
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  const escapes = (b: ReturnType<typeof pathBounds>) =>
    b.minX < boundary.x || b.maxX > boundary.x + boundary.width ||
    b.minY < boundary.y || b.maxY > boundary.y + boundary.height;

  // Each side of the boundary, with the handle point on that side.
  const sides: [Position, number, number][] = [
    [Position.Left, boundary.x, 200],
    [Position.Right, boundary.x + boundary.width, 200],
    [Position.Top, 300, boundary.y],
    [Position.Bottom, 300, boundary.y + boundary.height],
  ];

  for (const [side, sx, sy] of sides) {
    const routed = getContainmentAwarePositions("target-inside", side, Position.Left);
    assert(!escapes(pathBounds(routed.sourcePosition, sx, sy)),
      `a boundary handle on the ${side} side routes to a contained node without leaving the boundary`);
  }

  // And the unfixed behavior really did escape - otherwise the assertions
  // above would pass whether or not the flip happened.
  assert(escapes(pathBounds(Position.Left, boundary.x, 200)),
    "without the flip the same edge leaves the boundary and comes back - the behavior reported in issue #29");
}

// === Part 11: the click band is pulled clear of the boundary's connector ===
// React Flow draws a 20px transparent stroke over every edge as its click
// target, ending exactly on the endpoint. On a boundary's own connector
// that band covers the handle - and since an edge touching a nested node
// always paints above the boundary, the band wins the hit test and the
// connector can't be grabbed to start a new edge.
{
  const points = { sourceX: 320, sourceY: 100, targetX: 302, targetY: 175 };
  const routed = getContainmentAwarePositions("target-inside", Position.Top, Position.Top);
  const inset = getClickBandEndpoints("target-inside", points, routed);

  assert(inset.sourceY === 100 + HANDLE_CLEARANCE, "the boundary end of the band retreats INWARD along the edge, not sideways off it");
  assert(inset.sourceX === points.sourceX, "and doesn't drift across the other axis");
  assert(inset.targetX === points.targetX && inset.targetY === points.targetY, "the contained node's end is untouched - its handle isn't the one being covered");

  // A handle is 8px plus a 2px border each side, so ~6px either side of
  // the border line. The clearance has to beat that.
  assert(HANDLE_CLEARANCE > 6, `the clearance (${HANDLE_CLEARANCE}px) exceeds the handle's own ~6px radius, so the band's end cap lands clear of it`);
}

// === Part 12: each side retreats along its own axis ===
{
  const points = { sourceX: 300, sourceY: 200, targetX: 400, targetY: 250 };
  const cases: [Position, "sourceX" | "sourceY", number][] = [
    [Position.Top, "sourceY", 200 + HANDLE_CLEARANCE],    // flips to Bottom -> inward is +y
    [Position.Bottom, "sourceY", 200 - HANDLE_CLEARANCE], // flips to Top -> inward is -y
    [Position.Left, "sourceX", 300 + HANDLE_CLEARANCE],   // flips to Right -> inward is +x
    [Position.Right, "sourceX", 300 - HANDLE_CLEARANCE],  // flips to Left -> inward is -x
  ];
  for (const [side, axis, expected] of cases) {
    const routed = getContainmentAwarePositions("target-inside", side, Position.Left);
    const inset = getClickBandEndpoints("target-inside", points, routed);
    assert(inset[axis] === expected, `a connector on the ${side} side retreats into the boundary along the right axis`);
  }
}

// === Part 13: ordinary edges keep React Flow's default band ===
{
  const points = { sourceX: 10, sourceY: 20, targetX: 30, targetY: 40 };
  const routed = getContainmentAwarePositions("none", Position.Left, Position.Right);
  const inset = getClickBandEndpoints("none", points, routed);

  assert(
    inset.sourceX === 10 && inset.sourceY === 20 && inset.targetX === 30 && inset.targetY === 40,
    "an edge between unrelated nodes is returned unchanged, so it keeps React Flow's own click band"
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
