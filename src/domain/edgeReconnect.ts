/**
 * Working out what an edge's endpoints should actually become after
 * someone drags one of its ends onto a different node.
 *
 * This is a separate module from the React Flow wiring for one specific
 * reason: React Flow's own `onReconnect` hands back a Connection whose
 * source/target orientation can't be taken at face value in this app.
 * Every node stacks a source-type AND a target-type handle at each
 * position (see BidirectionalHandles.tsx), and React Flow decides which
 * end of a Connection is which from the handle TYPES it ended up on, not
 * from which end the person actually dragged. Canvas.tsx already carries
 * a fix for exactly this on edge CREATION (see connectStartNodeId);
 * reconnection has the same problem and needs the same kind of fix,
 * which is worth having somewhere it can be tested directly.
 */

export interface EdgeEndpoints {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Which end of the edge is being dragged - React Flow reports this to
 * onReconnectStart as its `handleType` argument. */
export type EdgeEnd = "source" | "target";

/** Handles are `string | null | undefined` depending on who produced
 * them; null and undefined both mean "the node's default handle". */
function sameHandle(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

export function isSameEndpoints(a: EdgeEndpoints, b: EdgeEndpoints): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    sameHandle(a.sourceHandle, b.sourceHandle) &&
    sameHandle(a.targetHandle, b.targetHandle)
  );
}

/**
 * The edge's new endpoints, with the end that WASN'T dragged pinned to
 * exactly what it already was.
 *
 * Pinning it is the whole trick. Rather than trusting which end of the
 * incoming Connection is labelled "source", this finds whichever end of
 * it corresponds to the anchored (undragged) end and treats the OTHER
 * one as the new position of the dragged end. An inverted Connection
 * therefore resolves correctly instead of silently reversing the edge's
 * direction as a side effect of moving one of its ends.
 *
 * Matching is on node id AND handle id first, falling back to node id
 * alone. Both are needed: the handle makes a self-loop (both ends on one
 * node, distinguishable only by handle) resolve correctly, and the
 * node-only fallback covers a reconnection that lands on a node's
 * default handle where the ids won't line up.
 */
export function normalizeReconnection(
  oldEdge: EdgeEndpoints,
  connection: EdgeEndpoints,
  draggedEnd: EdgeEnd
): EdgeEndpoints {
  const anchoredNode = draggedEnd === "target" ? oldEdge.source : oldEdge.target;
  const anchoredHandle = draggedEnd === "target" ? oldEdge.sourceHandle : oldEdge.targetHandle;

  const ends = [
    { node: connection.source, handle: connection.sourceHandle },
    { node: connection.target, handle: connection.targetHandle },
  ];

  let anchoredIndex = ends.findIndex((e) => e.node === anchoredNode && sameHandle(e.handle, anchoredHandle));
  if (anchoredIndex === -1) anchoredIndex = ends.findIndex((e) => e.node === anchoredNode);
  if (anchoredIndex === -1) {
    // Neither end of the Connection is the anchored one at all. That
    // shouldn't happen, but guessing wrong here would reverse an edge,
    // so fall back to React Flow's own orientation rather than to
    // whichever end happens to be first.
    anchoredIndex = draggedEnd === "target" ? 0 : 1;
  }
  const dragged = ends[anchoredIndex === 0 ? 1 : 0];

  return draggedEnd === "target"
    ? {
        source: anchoredNode,
        sourceHandle: anchoredHandle,
        target: dragged.node,
        targetHandle: dragged.handle,
      }
    : {
        source: dragged.node,
        sourceHandle: dragged.handle,
        target: anchoredNode,
        targetHandle: anchoredHandle,
      };
}

export type ReconnectionCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether a reconnection is actually allowed to be written to the store.
 *
 * The one real rule is that both ends have to be nodes at the edge's own
 * level of the sub-diagram tree. An edge and its endpoints share a
 * parentPath in the flattened schema (see diagramStore.ts), and an edge
 * pointing at a node one level down would filter out of
 * getEdgesAtPath's results at BOTH levels - visible from neither, but
 * still there, and still deleted-cascaded later on. React Flow only
 * renders one level at a time so a drag can't normally reach off-level,
 * but this is the store-facing boundary and the failure is silent, so
 * it's checked rather than assumed.
 *
 * Self-loops are deliberately allowed: the app already supports them
 * (onConnect will happily create one) and there's no reason moving an
 * end should be stricter than drawing a new edge.
 */
export function validateReconnection(
  next: EdgeEndpoints,
  nodeIdsAtLevel: ReadonlySet<string>
): ReconnectionCheck {
  if (!nodeIdsAtLevel.has(next.source)) {
    return { ok: false, reason: `source node ${next.source} is not at this diagram level` };
  }
  if (!nodeIdsAtLevel.has(next.target)) {
    return { ok: false, reason: `target node ${next.target} is not at this diagram level` };
  }
  return { ok: true };
}
