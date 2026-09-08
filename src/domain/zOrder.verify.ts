/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/zOrder.verify.ts
 */
import {
  boxesOverlap,
  computeAutoZIndices,
  computeEffectiveZIndices,
  applyZOrderCommand,
  type ZOrderBox,
} from "./zOrder";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

function box(id: string, x: number, y: number, width: number, height: number, zIndex?: number): ZOrderBox {
  return { id, x, y, width, height, zIndex };
}

// === Part 1: the reported bug - a big rectangle over small nodes ===
// From issue #25: nodes drawn under a rectangle became unselectable
// because the rectangle painted over them.
{
  const boxes = [
    box("rect", 0, 0, 400, 300),
    box("node-a", 20, 20, 100, 60),
    box("node-b", 20, 120, 100, 60),
  ];
  const z = computeEffectiveZIndices(boxes);

  assert(z.get("rect")! < z.get("node-a")!, "a large rectangle sits behind a small node it covers - the nodes stay clickable");
  assert(z.get("rect")! < z.get("node-b")!, "and behind every node it covers, not just the first");
}

// === Part 2: rectangle inside a rectangle ===
// The nested case: the bigger one is the container, so it goes behind.
{
  const boxes = [box("outer", 0, 0, 500, 400), box("inner", 50, 50, 200, 150)];
  const z = computeEffectiveZIndices(boxes);

  assert(z.get("outer")! < z.get("inner")!, "of two nested rectangles the BIGGER one is furthest back - it's the grouping boundary, so what's inside it draws on top");
}

// === Part 3: three levels of nesting ===
{
  const boxes = [box("small", 20, 20, 50, 50), box("huge", 0, 0, 900, 900), box("medium", 10, 10, 300, 300)];
  const z = computeEffectiveZIndices(boxes);

  assert(z.get("huge")! < z.get("medium")! && z.get("medium")! < z.get("small")!, "nesting works to any depth without a special case - it falls out of ordering by area");
}

// === Part 4: a SMALL shape on top of a big node stays on top ===
// Why the rule is area rather than node type: "shapes always go behind"
// would bury a callout drawn deliberately over something large.
{
  const boxes = [box("big-node", 0, 0, 400, 300), box("callout", 100, 100, 80, 40)];
  const z = computeEffectiveZIndices(boxes);

  assert(z.get("callout")! > z.get("big-node")!, "a small shape drawn over a large node stays in front - size signals intent, not the node's type");
}

// === Part 5: automatic order is stable across renders ===
// Identically-sized boxes must not swap places when something unrelated
// changes, or they'd flicker.
{
  const first = computeAutoZIndices([box("b", 0, 0, 100, 100), box("a", 200, 0, 100, 100)]);
  const second = computeAutoZIndices([box("a", 200, 0, 100, 100), box("b", 0, 0, 100, 100)]);

  assert(first.get("a") === second.get("a") && first.get("b") === second.get("b"), "equal-area boxes get the same z regardless of input order - the value comes from the box's own area, so array order can't perturb it");
}

// === Part 6: an explicit override is used verbatim ===
// Explicit values share a scale with the automatic ones, because the
// front/back commands work from the effective z of everything on the
// canvas and would otherwise be comparing incomparable numbers.
{
  const boxes = [box("rect", 0, 0, 400, 300, 950), box("node", 20, 20, 100, 60)];
  const z = computeEffectiveZIndices(boxes);

  assert(z.get("rect") === 950, "an explicit zIndex is used exactly as given, not recomputed from geometry");
  assert(z.get("rect")! > z.get("node")!, "so a rectangle explicitly raised above the automatic range sits in front of a small node, overriding the area rule");
}

// === Part 6b: automatic values stay below React Flow's selection lift ===
// React Flow adds 1000 to a selected node's z. Automatic values have to
// stay under that, or selecting a node wouldn't reliably raise it.
{
  const z = computeEffectiveZIndices([box("tiny", 0, 0, 1, 1), box("unmeasured", 0, 0, 0, 0), box("huge", 0, 0, 5000, 5000)]);
  assert([...z.values()].every((v) => v >= 0 && v < 1000), `every automatic z-index stays within 0..999 - got ${[...z.values()].join(", ")}`);
}

// === Part 6c: one node resizing does NOT disturb the others ===
// The regression this scheme exists to prevent. An earlier version
// assigned a dense rank by size, so any node changing size shifted the
// rank - and therefore the z-index - of every node sorted after it.
// React Flow rebuilds a node's internals whenever its z changes, so a
// single measurement re-rendered a large fraction of the graph. On a
// real document it moved 67 of 137 nodes.
{
  const many: ZOrderBox[] = Array.from({ length: 137 }, (_, i) => ({
    id: `n${i}`, x: 0, y: 0, width: 100 + i, height: 60,
  }));
  const before = computeEffectiveZIndices(many);
  const after = computeEffectiveZIndices(many.map((b) => (b.id === "n70" ? { ...b, width: 400 } : b)));

  const moved = many.filter((b) => before.get(b.id) !== after.get(b.id)).map((b) => b.id);
  assert(moved.length === 1 && moved[0] === "n70", `resizing one node changes ONLY that node's z-index - got ${moved.length} changed (${moved.slice(0, 5).join(", ")})`);
}

// === Part 7: bring to front ===
{
  const boxes = [box("rect", 0, 0, 400, 300), box("a", 20, 20, 100, 60), box("b", 150, 20, 100, 60)];
  const patches = applyZOrderCommand(boxes, ["rect"], "front");

  assert(patches.length === 1 && patches[0].id === "rect", "bringing to front patches only the selected node");
  const after = computeEffectiveZIndices(boxes.map((b) => (b.id === "rect" ? { ...b, zIndex: patches[0].zIndex } : b)));
  assert(after.get("rect")! > after.get("a")! && after.get("rect")! > after.get("b")!, "and it lands above everything else");
}

// === Part 8: send to back ===
{
  // The rectangle has been explicitly raised in front of the node, so
  // there is genuinely something for "send to back" to undo.
  const boxes = [box("node", 20, 20, 100, 60), box("rect", 0, 0, 400, 300, 950)];
  const patches = applyZOrderCommand(boxes, ["rect"], "back");
  assert(patches.length === 1, "sending to back produces a patch when the node isn't already at the back");
  const after = computeEffectiveZIndices(boxes.map((b) => (b.id === "rect" ? { ...b, zIndex: patches[0].zIndex } : b)));

  assert(after.get("rect")! < after.get("node")!, "sending to back drops it below everything - the fix for a rectangle covering things");
}

// === Part 9: repeated "front" on an already-frontmost node is a no-op ===
// Otherwise every click would inflate the stored number with nothing to
// show for it, and each one is a store write synced to every peer.
{
  const boxes = [box("a", 0, 0, 100, 100, 10), box("b", 0, 0, 100, 100, 1)];
  assert(applyZOrderCommand(boxes, ["a"], "front").length === 0, "bringing an already-frontmost node to the front changes nothing");
  assert(applyZOrderCommand(boxes, ["b"], "back").length === 0, "and the same for an already-backmost node");
}

// === Part 10: forward/backward only consider OVERLAPPING nodes ===
// Stepping past something on the far side of the canvas looks like
// nothing happened, and makes escaping a cover take many clicks.
{
  const boxes = [
    box("target", 0, 0, 100, 100, 1),
    box("cover", 50, 50, 100, 100, 2),
    box("far-away", 900, 900, 100, 100, 99),
  ];
  const patches = applyZOrderCommand(boxes, ["target"], "forward");

  assert(patches.length === 1, "moving forward produces one patch");
  assert(patches[0].zIndex > 2, "it steps past the node it actually overlaps");
  assert(patches[0].zIndex < 99, "and NOT past a distant node it doesn't overlap - that step would have been invisible");
}

// === Part 11: forward with nothing overlapping is a no-op ===
{
  const boxes = [box("alone", 0, 0, 100, 100), box("elsewhere", 500, 500, 100, 100)];
  assert(applyZOrderCommand(boxes, ["alone"], "forward").length === 0, "a node overlapping nothing has no reordering to do, so the command does nothing rather than silently changing a number");
}

// === Part 12: a multi-node selection moves as a block ===
{
  const boxes = [box("a", 0, 0, 100, 100, 1), box("b", 0, 0, 100, 100, 2), box("other", 0, 0, 100, 100, 5)];
  const patches = applyZOrderCommand(boxes, ["a", "b"], "front");
  const byId = new Map(patches.map((p) => [p.id, p.zIndex]));

  assert(patches.length === 2, "both selected nodes are patched");
  assert(byId.get("a")! > 5 && byId.get("b")! > 5, "both end up above the unselected node");
  assert(byId.get("a")! < byId.get("b")!, "and keep their own relative order rather than collapsing onto one value");
}

// === Part 13: overlap detection excludes merely touching edges ===
{
  assert(boxesOverlap(box("a", 0, 0, 100, 100), box("b", 50, 50, 100, 100)), "genuinely overlapping boxes are detected");
  assert(!boxesOverlap(box("a", 0, 0, 100, 100), box("b", 100, 0, 100, 100)), "boxes sharing only an edge don't count - neither is obscuring the other");
  assert(!boxesOverlap(box("a", 0, 0, 100, 100), box("b", 200, 200, 50, 50)), "separated boxes don't overlap");
}

// === Part 14: an unmeasured node (zero size) doesn't break ordering ===
// Nodes report no dimensions until React Flow has measured them.
{
  const boxes = [box("unmeasured", 0, 0, 0, 0), box("rect", 0, 0, 400, 300)];
  const z = computeEffectiveZIndices(boxes);

  assert(z.get("rect")! < z.get("unmeasured")!, "a not-yet-measured node is treated as zero-area and lands in front rather than throwing off the sort");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
