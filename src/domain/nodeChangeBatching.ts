import type { NodeChange, EdgeChange } from "@xyflow/react";

export type PendingNodeUpdate =
  | { type: "position"; position: { x: number; y: number } }
  | { type: "dimensions"; width?: number; height?: number };

/**
 * Pure logic behind onNodesChange's/onEdgesChange's synchronous
 * selection handling - separated out for the same testability reason as
 * classifyNodeChanges below (no React state setters or hooks to
 * exercise directly in a plain Node script).
 *
 * Exists because React Flow's own source (SelectionListenerInner) calls
 * onSelectionChange from INSIDE a useEffect, one render cycle after the
 * actual click - which produced a real, reported bug: selecting node A
 * appeared to do nothing, and only selecting node B afterward caused A
 * (not B) to visibly become selected, exactly the symptom of a
 * selection update that's always one interaction behind. Handling
 * 'select' changes here, synchronously and immediately as part of
 * onNodesChange/onEdgesChange itself (which fire directly from the
 * click, not from a delayed effect), closes that gap.
 *
 * Each 'select' change is independent and incremental - a normal click
 * replacing the whole selection still arrives as multiple changes in
 * the same batch (deselect whatever was selected before, select the new
 * one), not a single "replace everything" event - so folding them into
 * `current` one at a time, in order, is the correct way to interpret a
 * batch, not an approximation of it.
 */
export function applySelectionChanges(changes: (NodeChange | EdgeChange)[], current: string[]): string[] {
  let result = current;
  for (const change of changes) {
    if (change.type !== "select") continue;
    if (change.selected) {
      if (!result.includes(change.id)) result = [...result, change.id];
    } else if (result.includes(change.id)) {
      result = result.filter((id) => id !== change.id);
    }
  }
  return result;
}

/** Minimal snapshot of a node's current geometry, used only to detect
 * no-op changes before they're queued - see classifyNodeChanges below. */
export interface CurrentNodeGeometry {
  position: { x: number; y: number };
  width?: number;
  height?: number;
  /** Whether this node's size comes from its own content rather than
   * from a user resize gesture - see isAutoSizedNodeType below. */
  isAutoSized: boolean;
}

/**
 * Whether a node type sizes itself from its content, as opposed to
 * carrying a width/height the user set by dragging a NodeResizer.
 *
 * Only "typed" nodes are content-sized: group/shape/text/code all
 * render a NodeResizer and genuinely own an explicit, user-chosen
 * width/height that has to be shared with everyone else in a session.
 *
 * The distinction matters because React Flow applies a node's explicit
 * width/height as an INLINE STYLE on the wrapper element it renders
 * around the node component (NodeWrapper: `width: node.width ??
 * node.style?.width`). Writing a content-sized node's MEASURED height
 * back as an explicit height therefore pins that wrapper to a fixed
 * box, and since the ResizeObserver observes that same wrapper, the
 * wrapper can no longer change size in response to its own content -
 * so the pinned value is frozen at whatever happened to be measured on
 * whichever client committed it first. Any client whose content lays
 * out even slightly taller (web font still loading at measure time,
 * different text metrics, a label edited since) then renders its
 * visible card overflowing a wrapper that's too short, while handles
 * and peer selection outlines - which are positioned against the
 * wrapper, not the card - sit inside the card's visible bounds.
 */
export function isAutoSizedNodeType(type: string | undefined): boolean {
  return type === "typed";
}

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
 * `currentNodes` is looked up to skip a change ENTIRELY - never even
 * queuing it - when the incoming value is identical to what the node
 * already has. This is not just an optimization: a real, reported bug
 * traced back to exactly this gap. React Flow re-measures every node's
 * rendered dimensions via ResizeObserver and emits them through
 * onNodesChange whenever it observes them, including when nothing
 * actually changed - and unconditionally writing every one of those
 * "unchanged" dimensions to the store (particularly the Yjs-backed
 * session store, which rebuilds every node's object reference on any
 * single write, unlike the local store's targeted-path update) forces
 * every node component to re-render, which re-triggers ResizeObserver,
 * which re-emits the same unchanged dimensions again - a feedback loop
 * that needs nothing to actually change to keep running indefinitely,
 * many times a second. Comparing against the node's actual current
 * geometry and skipping identical values breaks that loop at its
 * source, regardless of why React Flow keeps re-emitting them.
 *
 * Returns whether this batch represents an ACTIVE, still-in-progress
 * gesture (dragging or resizing) as opposed to a completed drag/resize
 * (dragging/resizing explicitly false) or a standalone change with no
 * such flag at all (an arrow-key nudge, or the alignment-snap
 * correction onNodeDragStop makes after a drag already ended) - the
 * caller uses this to decide whether to wait for the next animation
 * frame or commit immediately. A no-op change never counts toward this
 * either - a batch of nothing-but-unchanged dimensions has nothing to
 * flush, active gesture or not.
 */
export function classifyNodeChanges(
  changes: NodeChange[],
  pending: Map<string, PendingNodeUpdate>,
  currentNodes: Map<string, CurrentNodeGeometry>
): { isActiveGesture: boolean } {
  let isActiveGesture = false;
  for (const change of changes) {
    if (change.type === "position" && change.position) {
      const current = currentNodes.get(change.id);
      const isNoOp = !!current && current.position.x === change.position.x && current.position.y === change.position.y;
      if (!isNoOp) {
        pending.set(change.id, { type: "position", position: change.position });
        if (change.dragging === true) isActiveGesture = true;
      }
    } else if (change.type === "dimensions" && change.dimensions) {
      // Passive measurements from React Flow's internal ResizeObserver
      // (where `change.resizing` is undefined) must NEVER be committed
      // to the document store - they are local rendering measurements,
      // not user edits. Only explicit user resize gestures (where
      // `change.resizing` is true while dragging, or false on release)
      // represent user intent to change the node's stored dimensions.
      if (change.resizing === undefined) continue;
      const current = currentNodes.get(change.id);
      if (current?.isAutoSized) continue;
      const isNoOp = !!current && current.width === change.dimensions.width && current.height === change.dimensions.height;
      if (!isNoOp) {
        pending.set(change.id, {
          type: "dimensions",
          width: change.dimensions.width,
          height: change.dimensions.height,
        });
        if (change.resizing === true) isActiveGesture = true;
      }
    }
  }
  return { isActiveGesture };
}
