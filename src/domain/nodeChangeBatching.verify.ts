/**
 * Standalone verification for classifyNodeChanges - the pure decision
 * logic behind App.tsx's rAF-throttled onNodesChange. Run with:
 *
 *   npx tsx src/domain/nodeChangeBatching.verify.ts
 *
 * This exists specifically because a real, severe bug report (abysmal
 * performance while dragging, plus nodes visibly disappearing mid-drag)
 * traced back to committing a full store update on every single
 * mousemove-driven position-change event, rather than at most once per
 * animation frame. Getting the batching/flush-timing decision right
 * matters more here than almost anywhere else in the app, since a
 * mistake could mean either the fix not actually reducing commit
 * frequency (leaving the original bug in place) or a dropped/stale
 * position being committed (a new, worse bug) - so this is tested
 * thoroughly rather than trusted from a single manual read-through.
 */
import { classifyNodeChanges, applySelectionChanges, isAutoSizedNodeType, type PendingNodeUpdate, type CurrentNodeGeometry } from "./nodeChangeBatching";
import type { NodeChange } from "@xyflow/react";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

// === Part 1: a single mid-drag position change is queued, not committed ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [{ id: "n1", type: "position", position: { x: 10, y: 20 }, dragging: true }];
  const { isActiveGesture } = classifyNodeChanges(changes, pending, new Map<string, CurrentNodeGeometry>());

  assert(isActiveGesture, "a position change with dragging: true is correctly reported as an active, in-progress gesture");
  assert(pending.size === 1 && pending.get("n1")?.type === "position", "the position change is queued into the pending map");
}

// === Part 2: the final event of a drag (dragging: false) is NOT an active gesture ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [{ id: "n1", type: "position", position: { x: 99, y: 99 }, dragging: false }];
  const { isActiveGesture } = classifyNodeChanges(changes, pending, new Map<string, CurrentNodeGeometry>());

  assert(!isActiveGesture, "the drag-ending event (dragging: false) is correctly NOT treated as an active gesture - the caller should flush immediately, not wait for another frame");
  const update = pending.get("n1");
  assert(update?.type === "position" && update.position.x === 99 && update.position.y === 99, "the final position is still correctly queued for the (immediate) flush");
}

// === Part 3: a standalone change with no dragging flag at all (arrow-key nudge, alignment-snap correction) is NOT an active gesture ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [{ id: "n1", type: "position", position: { x: 5, y: 5 } }]; // no `dragging` field at all
  const { isActiveGesture } = classifyNodeChanges(changes, pending, new Map<string, CurrentNodeGeometry>());

  assert(!isActiveGesture, "a position change with no dragging flag at all (e.g. an arrow-key nudge) is treated the same as a completed gesture - commit right away, don't wait a frame for something that was never a high-frequency gesture to begin with");
}

// === Part 4: multiple position changes for the SAME node within one batch - only the latest survives ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [
    { id: "n1", type: "position", position: { x: 1, y: 1 }, dragging: true },
    { id: "n1", type: "position", position: { x: 2, y: 2 }, dragging: true },
    { id: "n1", type: "position", position: { x: 3, y: 3 }, dragging: true },
  ];
  classifyNodeChanges(changes, pending, new Map<string, CurrentNodeGeometry>());

  const update = pending.get("n1");
  assert(pending.size === 1 && update?.type === "position" && update.position.x === 3, "multiple position changes for the same node id in one batch correctly deduplicate to only the LAST one, not three separate pending entries");
}

// === Part 5: a multi-node drag - each node gets its own independent pending entry ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [
    { id: "a", type: "position", position: { x: 10, y: 10 }, dragging: true },
    { id: "b", type: "position", position: { x: 20, y: 20 }, dragging: true },
    { id: "c", type: "position", position: { x: 30, y: 30 }, dragging: true },
  ];
  const { isActiveGesture } = classifyNodeChanges(changes, pending, new Map<string, CurrentNodeGeometry>());

  assert(isActiveGesture, "a multi-node drag is correctly treated as an active gesture");
  assert(pending.size === 3, "each of the three simultaneously-dragged nodes gets its own independent pending entry, not merged or overwritten");
  assert((pending.get("b") as { type: "position"; position: { x: number } }).position.x === 20, "each node's own position is preserved correctly, not mixed up with another node's");
}

// === Part 6: a mixed batch - if ANY change in the batch is still actively dragging, the whole batch is treated as active ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [
    { id: "a", type: "position", position: { x: 1, y: 1 }, dragging: false }, // this one just finished
    { id: "b", type: "position", position: { x: 2, y: 2 }, dragging: true }, // this one is still going
  ];
  const { isActiveGesture } = classifyNodeChanges(changes, pending, new Map<string, CurrentNodeGeometry>());

  assert(isActiveGesture, "if even one change in the batch is still actively dragging, the whole batch waits for the next frame rather than committing immediately - correct, since node b's gesture is still in progress");
}

// === Part 7: dimensions/resizing follow the identical pattern to position/dragging ===
{
  const pendingActive = new Map<string, PendingNodeUpdate>();
  const { isActiveGesture: activeDuringResize } = classifyNodeChanges([{ id: "n1", type: "dimensions", dimensions: { width: 200, height: 150 }, resizing: true }], pendingActive, new Map<string, CurrentNodeGeometry>());
  assert(activeDuringResize, "a dimensions change with resizing: true is correctly treated as an active gesture");
  assert(pendingActive.get("n1")?.type === "dimensions", "the dimensions change is correctly queued");

  const pendingDone = new Map<string, PendingNodeUpdate>();
  const { isActiveGesture: activeAfterResize } = classifyNodeChanges([{ id: "n1", type: "dimensions", dimensions: { width: 200, height: 150 }, resizing: false }], pendingDone, new Map<string, CurrentNodeGeometry>());
  assert(!activeAfterResize, "the resize-ending event (resizing: false) is correctly NOT treated as an active gesture");
}

// === Part 8: irrelevant change types (select, remove, add) are ignored entirely - no pending entry, no effect on isActiveGesture ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [
    { id: "n1", type: "select", selected: true },
    { id: "n2", type: "remove" },
  ];
  const { isActiveGesture } = classifyNodeChanges(changes, pending, new Map<string, CurrentNodeGeometry>());

  assert(!isActiveGesture, "a batch containing only selection/removal changes is not treated as an active drag/resize gesture");
  assert(pending.size === 0, "selection and removal changes create no pending position/dimension entries at all - there's nothing for this function to do with them");
}

// === Part 9: accumulation across multiple calls - simulating several onNodesChange invocations before a single flush, exactly as happens during a real drag ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  classifyNodeChanges([{ id: "n1", type: "position", position: { x: 1, y: 1 }, dragging: true }], pending, new Map<string, CurrentNodeGeometry>());
  classifyNodeChanges([{ id: "n1", type: "position", position: { x: 2, y: 2 }, dragging: true }], pending, new Map<string, CurrentNodeGeometry>());
  classifyNodeChanges([{ id: "n2", type: "position", position: { x: 100, y: 100 }, dragging: true }], pending, new Map<string, CurrentNodeGeometry>());

  assert(pending.size === 2, "three separate onNodesChange calls across two distinct nodes correctly accumulate into exactly two pending entries, not three");
  assert((pending.get("n1") as { type: "position"; position: { x: number } }).position.x === 2, "n1's pending entry reflects its most recent call, not its first");
}

// === Part 10: applySelectionChanges - a single select ===
{
  const result = applySelectionChanges([{ id: "a", type: "select", selected: true }], []);
  assert(result.length === 1 && result[0] === "a", "a single select change correctly adds that id to an empty selection");
}

// === Part 11: applySelectionChanges - THE EXACT REPORTED BUG: selecting node A, then selecting node B, must result in B selected, not A ===
{
  // Click 1: select A. A real click on an unselected node with nothing
  // else selected produces just the one 'select: true' change.
  const afterClickA = applySelectionChanges([{ id: "A", type: "select", selected: true }], []);
  assert(afterClickA.length === 1 && afterClickA[0] === "A", "after the first click (selecting A), A is correctly selected");

  // Click 2: select B. A normal (non-shift) click replacing the
  // selection arrives as MULTIPLE changes in the same batch - deselect
  // whatever was selected before (A), select the new one (B) - not a
  // single "replace everything" event.
  const afterClickB = applySelectionChanges(
    [
      { id: "A", type: "select", selected: false },
      { id: "B", type: "select", selected: true },
    ],
    afterClickA
  );
  assert(
    afterClickB.length === 1 && afterClickB[0] === "B",
    "after the second click (selecting B), the result is B alone - NOT A, which is the exact bug reported: selecting A appeared to do nothing, and selecting B afterward caused A (not B) to visibly become selected"
  );
}

// === Part 12: applySelectionChanges - shift-click style multi-select (add without deselecting) ===
{
  const afterA = applySelectionChanges([{ id: "A", type: "select", selected: true }], []);
  const afterShiftB = applySelectionChanges([{ id: "B", type: "select", selected: true }], afterA);
  assert(afterShiftB.length === 2 && afterShiftB.includes("A") && afterShiftB.includes("B"), "a shift-click-style change (select B without deselecting A) correctly results in both being selected");
}

// === Part 13: applySelectionChanges - deselecting (clicking empty canvas) ===
{
  const afterA = applySelectionChanges([{ id: "A", type: "select", selected: true }], []);
  const afterDeselect = applySelectionChanges([{ id: "A", type: "select", selected: false }], afterA);
  assert(afterDeselect.length === 0, "deselecting the only selected node correctly results in an empty selection");
}

// === Part 14: applySelectionChanges - idempotency (selecting an already-selected node doesn't duplicate it) ===
{
  const afterA = applySelectionChanges([{ id: "A", type: "select", selected: true }], []);
  const afterAAgain = applySelectionChanges([{ id: "A", type: "select", selected: true }], afterA);
  assert(afterAAgain.length === 1 && afterAAgain[0] === "A", "selecting an already-selected node again doesn't add a duplicate entry");
}

// === Part 15: applySelectionChanges - non-select changes are ignored, and the SAME reference is returned when nothing selection-related changed ===
{
  const current = ["A"];
  const result = applySelectionChanges([{ id: "n1", type: "position", position: { x: 1, y: 1 }, dragging: true }], current);
  assert(result === current, "a batch with no 'select' changes at all returns the EXACT SAME array reference, not a new (even if equal-content) one - this is what lets React's own setState bail out of an unnecessary re-render during an ordinary drag");
}

// === Part 16: a dimensions change IDENTICAL to the node's current geometry is NOT queued at all - THE ACTUAL FIX for the reported infinite loop ===
// React Flow re-measures every node's dimensions via ResizeObserver and
// re-emits them through onNodesChange whenever it observes them,
// including when nothing changed. Writing every one of those unconditionally
// to the store forced a full re-render on every emission, which
// re-triggered ResizeObserver, which re-emitted the same values again -
// a self-sustaining loop needing nothing to actually change to keep running.
{
  const pending = new Map<string, PendingNodeUpdate>();
  const current = new Map<string, CurrentNodeGeometry>([["n1", { position: { x: 0, y: 0 }, width: 200, height: 100, isAutoSized: false }]]);
  const changes: NodeChange[] = [{ id: "n1", type: "dimensions", dimensions: { width: 200, height: 100 } }];
  const { isActiveGesture } = classifyNodeChanges(changes, pending, current);

  assert(pending.size === 0, "a dimensions change identical to the node's current width/height is not queued at all - this is the actual fix for the reported infinite loop, where React Flow kept re-emitting unchanged dimensions and each one was previously written to the store unconditionally");
  assert(!isActiveGesture, "a no-op dimensions change (with no resizing flag) correctly doesn't count as an active gesture either");
}

// === Part 17: a dimensions change that's genuinely DIFFERENT from current geometry is still queued normally ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const current = new Map<string, CurrentNodeGeometry>([["n1", { position: { x: 0, y: 0 }, width: 200, height: 100, isAutoSized: false }]]);
  const changes: NodeChange[] = [{ id: "n1", type: "dimensions", dimensions: { width: 250, height: 100 } }]; // width genuinely changed
  classifyNodeChanges(changes, pending, current);

  assert(pending.size === 1 && pending.get("n1")?.type === "dimensions", "a dimensions change that's genuinely different from the current value (even if only one of width/height changed) is still correctly queued - the no-op guard doesn't accidentally swallow real changes");
}

// === Part 18: the same no-op guard applies to position changes ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const current = new Map<string, CurrentNodeGeometry>([["n1", { position: { x: 50, y: 75 }, isAutoSized: false }]]);

  const noOpChanges: NodeChange[] = [{ id: "n1", type: "position", position: { x: 50, y: 75 } }];
  classifyNodeChanges(noOpChanges, pending, current);
  assert(pending.size === 0, "a position change identical to the node's current position is not queued at all");

  const realChanges: NodeChange[] = [{ id: "n1", type: "position", position: { x: 51, y: 75 } }]; // x genuinely moved
  classifyNodeChanges(realChanges, pending, current);
  assert(pending.size === 1, "a position change that's genuinely different (even by one pixel) is still correctly queued");
}

// === Part 19: a change for a node with NO entry in currentNodes at all (e.g. brand new node) is queued - there's nothing to compare against, so it can never be treated as a no-op ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const current = new Map<string, CurrentNodeGeometry>(); // empty - "n1" unknown
  const changes: NodeChange[] = [{ id: "n1", type: "dimensions", dimensions: { width: 100, height: 50 } }];
  classifyNodeChanges(changes, pending, current);

  assert(pending.size === 1, "a change for a node with no current-geometry entry at all is still queued normally - there's no known 'current' value to compare against, so it can never be mistaken for a no-op");
}

// === Part 20: THE EXACT REPORTED SCENARIO - a large batch of dimensions changes for many nodes, all identical to their current values, results in an empty pending map and no active gesture ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const current = new Map<string, CurrentNodeGeometry>();
  const changes: NodeChange[] = [];
  for (let i = 0; i < 50; i++) {
    const id = `node-${i}`;
    current.set(id, { position: { x: i * 10, y: 0 }, width: 226, height: 120, isAutoSized: false });
    changes.push({ id, type: "dimensions", dimensions: { width: 226, height: 120 } });
  }
  const { isActiveGesture } = classifyNodeChanges(changes, pending, current);

  assert(pending.size === 0, "a batch of 50 dimensions changes, every single one identical to its node's current geometry (matching the real bug report - React Flow re-measuring an entire diagram's worth of nodes to the same, unchanged sizes), results in an EMPTY pending map - nothing gets written, so the feedback loop has nothing left to sustain it");
  assert(!isActiveGesture, "a batch containing nothing but no-op changes is correctly not treated as an active gesture");
}

// === Part 21: a mixed batch - some no-op, some genuinely changed - only the real changes are queued ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const current = new Map<string, CurrentNodeGeometry>([
    ["unchanged", { position: { x: 0, y: 0 }, width: 100, height: 50, isAutoSized: false }],
    ["resized", { position: { x: 0, y: 0 }, width: 100, height: 50, isAutoSized: false }],
  ]);
  const changes: NodeChange[] = [
    { id: "unchanged", type: "dimensions", dimensions: { width: 100, height: 50 } }, // no-op
    { id: "resized", type: "dimensions", dimensions: { width: 150, height: 50 } }, // real change
  ];
  classifyNodeChanges(changes, pending, current);

  assert(pending.size === 1 && pending.has("resized") && !pending.has("unchanged"), "in a mixed batch, only the node that genuinely changed size is queued - the unchanged one is correctly filtered out without affecting the other");
}

// === Part 19: a CONTENT-SIZED node's dimensions are never queued at all ===
// React Flow applies an explicit width/height as an inline style on the
// wrapper it renders around each node, and observes that same wrapper
// for resizes. Persisting a content-sized node's MEASURED size as an
// explicit one therefore pins the wrapper to a fixed box that can no
// longer respond to its own content - freezing it at whatever one
// client measured, and leaving every other client's visible card
// overflowing a wrapper that handles and peer selection outlines are
// still positioned against. Each client measures this for itself.
{
  const pending = new Map<string, PendingNodeUpdate>();
  const current = new Map<string, CurrentNodeGeometry>([
    ["auto", { position: { x: 0, y: 0 }, isAutoSized: true }],
  ]);
  const changes: NodeChange[] = [{ id: "auto", type: "dimensions", dimensions: { width: 260, height: 126 } }];
  const { isActiveGesture } = classifyNodeChanges(changes, pending, current);

  assert(pending.size === 0, "a content-sized node's measured dimensions are never queued for the store, even though they differ from its (absent) explicit width/height - this is the fix for connectors and peer selection outlines rendering at the wrong size on other clients");
  assert(!isActiveGesture, "a dropped content-sized dimensions change doesn't count as an active gesture either");
}

// === Part 20: an explicitly-sized node's resize IS still queued ===
// The counterpart to Part 19 - group/shape/text/code nodes carry a
// genuinely user-chosen size from their NodeResizer, which every
// collaborator does need to see.
{
  const pending = new Map<string, PendingNodeUpdate>();
  const current = new Map<string, CurrentNodeGeometry>([
    ["grp", { position: { x: 0, y: 0 }, width: 400, height: 300, isAutoSized: false }],
  ]);
  const changes: NodeChange[] = [{ id: "grp", type: "dimensions", dimensions: { width: 520, height: 300 }, resizing: true }];
  const { isActiveGesture } = classifyNodeChanges(changes, pending, current);

  assert(pending.get("grp")?.type === "dimensions", "a resizable node's genuine resize is still queued normally");
  assert(isActiveGesture, "an in-progress resize of a resizable node is still reported as an active gesture");
}

// === Part 21: isAutoSizedNodeType classifies every node type in use ===
{
  assert(isAutoSizedNodeType("typed"), "typed nodes size themselves from their content");
  assert(!isAutoSizedNodeType("group"), "group nodes carry an explicit user-chosen size");
  assert(!isAutoSizedNodeType("shape"), "shape nodes carry an explicit user-chosen size");
  assert(!isAutoSizedNodeType("text"), "text nodes carry an explicit user-chosen size");
  assert(!isAutoSizedNodeType("code"), "code nodes carry an explicit user-chosen size");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
