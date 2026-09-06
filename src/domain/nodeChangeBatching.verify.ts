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
import { classifyNodeChanges, type PendingNodeUpdate } from "./nodeChangeBatching";
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
  const { isActiveGesture } = classifyNodeChanges(changes, pending);

  assert(isActiveGesture, "a position change with dragging: true is correctly reported as an active, in-progress gesture");
  assert(pending.size === 1 && pending.get("n1")?.type === "position", "the position change is queued into the pending map");
}

// === Part 2: the final event of a drag (dragging: false) is NOT an active gesture ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [{ id: "n1", type: "position", position: { x: 99, y: 99 }, dragging: false }];
  const { isActiveGesture } = classifyNodeChanges(changes, pending);

  assert(!isActiveGesture, "the drag-ending event (dragging: false) is correctly NOT treated as an active gesture - the caller should flush immediately, not wait for another frame");
  const update = pending.get("n1");
  assert(update?.type === "position" && update.position.x === 99 && update.position.y === 99, "the final position is still correctly queued for the (immediate) flush");
}

// === Part 3: a standalone change with no dragging flag at all (arrow-key nudge, alignment-snap correction) is NOT an active gesture ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [{ id: "n1", type: "position", position: { x: 5, y: 5 } }]; // no `dragging` field at all
  const { isActiveGesture } = classifyNodeChanges(changes, pending);

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
  classifyNodeChanges(changes, pending);

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
  const { isActiveGesture } = classifyNodeChanges(changes, pending);

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
  const { isActiveGesture } = classifyNodeChanges(changes, pending);

  assert(isActiveGesture, "if even one change in the batch is still actively dragging, the whole batch waits for the next frame rather than committing immediately - correct, since node b's gesture is still in progress");
}

// === Part 7: dimensions/resizing follow the identical pattern to position/dragging ===
{
  const pendingActive = new Map<string, PendingNodeUpdate>();
  const { isActiveGesture: activeDuringResize } = classifyNodeChanges(
    [{ id: "n1", type: "dimensions", dimensions: { width: 200, height: 150 }, resizing: true }],
    pendingActive
  );
  assert(activeDuringResize, "a dimensions change with resizing: true is correctly treated as an active gesture");
  assert(pendingActive.get("n1")?.type === "dimensions", "the dimensions change is correctly queued");

  const pendingDone = new Map<string, PendingNodeUpdate>();
  const { isActiveGesture: activeAfterResize } = classifyNodeChanges(
    [{ id: "n1", type: "dimensions", dimensions: { width: 200, height: 150 }, resizing: false }],
    pendingDone
  );
  assert(!activeAfterResize, "the resize-ending event (resizing: false) is correctly NOT treated as an active gesture");
}

// === Part 8: irrelevant change types (select, remove, add) are ignored entirely - no pending entry, no effect on isActiveGesture ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  const changes: NodeChange[] = [
    { id: "n1", type: "select", selected: true },
    { id: "n2", type: "remove" },
  ];
  const { isActiveGesture } = classifyNodeChanges(changes, pending);

  assert(!isActiveGesture, "a batch containing only selection/removal changes is not treated as an active drag/resize gesture");
  assert(pending.size === 0, "selection and removal changes create no pending position/dimension entries at all - there's nothing for this function to do with them");
}

// === Part 9: accumulation across multiple calls - simulating several onNodesChange invocations before a single flush, exactly as happens during a real drag ===
{
  const pending = new Map<string, PendingNodeUpdate>();
  classifyNodeChanges([{ id: "n1", type: "position", position: { x: 1, y: 1 }, dragging: true }], pending);
  classifyNodeChanges([{ id: "n1", type: "position", position: { x: 2, y: 2 }, dragging: true }], pending);
  classifyNodeChanges([{ id: "n2", type: "position", position: { x: 100, y: 100 }, dragging: true }], pending);

  assert(pending.size === 2, "three separate onNodesChange calls across two distinct nodes correctly accumulate into exactly two pending entries, not three");
  assert((pending.get("n1") as { type: "position"; position: { x: number } }).position.x === 2, "n1's pending entry reflects its most recent call, not its first");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
