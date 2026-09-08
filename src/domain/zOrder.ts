/**
 * Stacking order for canvas nodes.
 *
 * Two layers of rule, in order of precedence:
 *
 *   1. An explicit `zIndex` a person set with the front/back controls.
 *   2. Failing that, an automatic order derived from the node's AREA -
 *      larger nodes sit further back.
 *
 * The area rule is what makes the default behavior sensible without
 * anyone having to think about it. A big rectangle is nearly always a
 * boundary drawn AROUND things, so the things inside it should be on
 * top; if it isn't, it hides and blocks whatever it covers. That
 * generalises to the nested case without a special rule: of two
 * overlapping rectangles, the bigger one is the container, so it goes
 * behind - and it keeps working as either is resized, because the order
 * is derived from the current geometry rather than from whenever they
 * happened to be created.
 *
 * Node TYPE is deliberately not part of the rule. Saying "shapes always
 * go behind" would order a small callout rectangle behind a large node
 * it was drawn on top of, which is the same bug in the other direction.
 * Size is the thing that actually signals intent here.
 */

export interface ZOrderBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** An explicit override, if this node has one. */
  zIndex?: number;
}

/**
 * Automatic z-indices are spread across this range, largest area lowest.
 *
 * The ceiling is kept below React Flow's own selection elevation (it adds
 * 1000 to a selected node's z) so selecting something always lifts it
 * clear of the automatic ordering rather than competing with it.
 */
const AUTO_Z_MAX = 900;

/**
 * How finely area differences are resolved. Applied to log2(area), so
 * this is resolution in "doublings": two nodes whose areas differ by
 * less than roughly 2% land on the same z-index, which is fine - they're
 * the same size to the eye, and an arbitrary order between them is what
 * a tie-break would have produced anyway.
 */
const AREA_RESOLUTION = 40;

/**
 * True when two boxes share any area at all. Touching edges don't count -
 * two rectangles sitting flush against each other aren't obscuring
 * anything, so reordering them would be a no-op the person didn't ask
 * for.
 */
export function boxesOverlap(a: ZOrderBox, b: ZOrderBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function area(box: ZOrderBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

/**
 * The automatic z-index for every box without an explicit override.
 *
 * Derived from each box's OWN area, deliberately not from its rank among
 * the others. A dense rank (0, 1, 2, ... by size) expresses the same
 * ordering, but couples every node to every other: one node being
 * measured a few pixels differently shifts the rank - and therefore the
 * z-index - of every node sorted after it. React Flow rebuilds a node's
 * internals whenever its z changes, so that turned a single measurement
 * into a re-render of a large fraction of the graph. Measured on a real
 * document, resizing one node changed the z-index of 67 of 137 nodes.
 *
 * A function of area alone has no such coupling: a node's z-index
 * changes only when that node's own size changes. Ordering is preserved
 * because log2 is monotonic, so a bigger area still always maps to a
 * lower z-index.
 */
export function computeAutoZIndices(boxes: ZOrderBox[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const box of boxes) {
    if (box.zIndex !== undefined) continue;
    // log2 rather than raw area because areas span orders of magnitude -
    // a label and a backdrop rectangle can differ by a factor of a
    // thousand, and a linear mapping would collapse every ordinary node
    // into the same value at the top of the range.
    const scaled = Math.round(Math.log2(area(box) + 1) * AREA_RESOLUTION);
    result.set(box.id, Math.max(0, Math.min(AUTO_Z_MAX, AUTO_Z_MAX - scaled)));
  }
  return result;
}

/** The z-index a box actually renders at: its override if it has one,
 * otherwise its computed automatic value. */
export function effectiveZIndex(box: ZOrderBox, autoZIndices: Map<string, number>): number {
  return box.zIndex ?? autoZIndices.get(box.id) ?? AUTO_Z_MAX;
}

/** Every box's effective z-index, keyed by id - what the canvas hands
 * React Flow. */
export function computeEffectiveZIndices(boxes: ZOrderBox[]): Map<string, number> {
  const auto = computeAutoZIndices(boxes);
  const result = new Map<string, number>();
  for (const box of boxes) result.set(box.id, effectiveZIndex(box, auto));
  return result;
}

export type ZOrderCommand = "front" | "back" | "forward" | "backward";

/**
 * Works out the new explicit zIndex values for a z-order command,
 * returning only the nodes that actually need changing.
 *
 * "front"/"back" move the selection clear of EVERYTHING, which is what
 * a person reaching for those wants - they've got something buried and
 * want it out, or covering everything and want it gone.
 *
 * "forward"/"backward" step one place at a time, and only past nodes the
 * selection actually OVERLAPS. Stepping past something on the far side
 * of the canvas would look like nothing happened, and it can take many
 * clicks to escape a node that was never in the way. Nothing overlapping
 * means there is nothing to reorder, so the command is a no-op rather
 * than a silent number change.
 *
 * Returns an empty array when the command wouldn't change anything - so
 * callers can skip a pointless store write, and an already-frontmost
 * node doesn't accumulate ever-larger z-indices from repeated clicks.
 */
export function applyZOrderCommand(
  boxes: ZOrderBox[],
  selectedIds: string[],
  command: ZOrderCommand
): { id: string; zIndex: number }[] {
  const selected = new Set(selectedIds);
  const selectedBoxes = boxes.filter((b) => selected.has(b.id));
  if (selectedBoxes.length === 0) return [];

  const effective = computeEffectiveZIndices(boxes);
  const others = boxes.filter((b) => !selected.has(b.id));
  if (others.length === 0) return [];

  if (command === "front" || command === "back") {
    const otherZs = others.map((b) => effective.get(b.id)!);
    const target = command === "front" ? Math.max(...otherZs) + 1 : Math.min(...otherZs) - 1;

    // Already clear of everything - don't rewrite, or repeated clicks
    // would push the value up forever for no visible effect.
    const alreadyClear = selectedBoxes.every((b) =>
      command === "front" ? effective.get(b.id)! > Math.max(...otherZs) : effective.get(b.id)! < Math.min(...otherZs)
    );
    if (alreadyClear) return [];

    // The whole selection moves as a block, keeping its own internal
    // order rather than collapsing to one value.
    const ordered = [...selectedBoxes].sort((a, b) => effective.get(a.id)! - effective.get(b.id)!);
    return ordered.map((box, index) => ({
      id: box.id,
      zIndex: command === "front" ? target + index : target - (ordered.length - 1 - index),
    }));
  }

  // forward / backward: step past the nearest overlapping neighbour.
  const patches: { id: string; zIndex: number }[] = [];
  for (const box of selectedBoxes) {
    const myZ = effective.get(box.id)!;
    const overlapping = others.filter((other) => boxesOverlap(box, other));
    if (overlapping.length === 0) continue;

    if (command === "forward") {
      const above = overlapping.map((o) => effective.get(o.id)!).filter((z) => z > myZ);
      if (above.length === 0) continue; // already in front of everything it touches
      patches.push({ id: box.id, zIndex: Math.min(...above) + 1 });
    } else {
      const below = overlapping.map((o) => effective.get(o.id)!).filter((z) => z < myZ);
      if (below.length === 0) continue;
      patches.push({ id: box.id, zIndex: Math.min(...below) - 1 });
    }
  }
  return patches;
}
