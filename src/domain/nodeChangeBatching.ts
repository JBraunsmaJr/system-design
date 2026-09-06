import type { NodeChange } from "@xyflow/react";

export type PendingNodeUpdate =
  | { type: "position"; position: { x: number; y: number } }
  | { type: "dimensions"; width?: number; height?: number };

/**
 * Pure decision logic behind App.tsx's rAF-throttled onNodesChange -
 * separated out specifically so it's testable without a browser
 * (requestAnimationFrame/useRef, which the rest of that handling relies
 * on, aren't things a plain Node script can exercise).
 *
 * Mutates `pending` in place (adding/overwriting entries for whatever
 * changed in this batch) rather than returning a new map, since the
 * whole point is a single, long-lived pending map that accumulates
 * across many calls during a drag before being flushed - App.tsx owns
 * that map's lifetime via useRef, this function just knows how to
 * update it correctly for one batch of incoming changes.
 *
 * Returns whether this batch represents an ACTIVE, still-in-progress
 * gesture (dragging or resizing) as opposed to a completed drag/resize
 * (dragging/resizing explicitly false) or a standalone change with no
 * such flag at all (an arrow-key nudge, or the alignment-snap
 * correction onNodeDragStop makes after a drag already ended) - the
 * caller uses this to decide whether to wait for the next animation
 * frame or commit immediately.
 */
export function classifyNodeChanges(
  changes: NodeChange[],
  pending: Map<string, PendingNodeUpdate>
): { isActiveGesture: boolean } {
  let isActiveGesture = false;
  for (const change of changes) {
    if (change.type === "position" && change.position) {
      pending.set(change.id, { type: "position", position: change.position });
      if (change.dragging === true) isActiveGesture = true;
    } else if (change.type === "dimensions" && change.dimensions) {
      pending.set(change.id, {
        type: "dimensions",
        width: change.dimensions.width,
        height: change.dimensions.height,
      });
      if (change.resizing === true) isActiveGesture = true;
    }
  }
  return { isActiveGesture };
}
