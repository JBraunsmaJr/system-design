import type { Node } from '@xyflow/react';

type ParentLink = { id: string; parentId?: string };

/** How many group ancestors a node has (0 for a top-level node). Cycle-safe. */
function containmentDepth<T extends ParentLink>(node: T, byId: Map<string, T>): number {
  const visited = new Set<string>([node.id]);
  let depth = 0;
  let current = node.parentId;
  while (current !== undefined && !visited.has(current)) {
    const parent = byId.get(current);
    if (!parent) break;
    visited.add(current);
    depth++;
    current = parent.parentId;
  }
  return depth;
}

/**
 * React Flow requires a parent node to appear before its children in the
 * nodes array. Groups can nest inside other groups, so the invariant is
 * "every group before any non-group, and among groups, outer before
 * inner" - groups are ordered by nesting depth. Stable otherwise, so this is
 * safe to call after every add/reparent.
 */
export function reorderWithGroupsFirst<T extends { type?: string; id: string; parentId?: string }>(
  nodes: T[],
): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = nodes
    .filter((n) => n.type === 'group')
    .map((n, index) => ({ n, index, depth: containmentDepth(n, byId) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(({ n }) => n);
  const rest = nodes.filter((n) => n.type !== 'group');
  return [...groups, ...rest];
}

/**
 * Converts a node's position to canvas-absolute coordinates, given its
 * current parent (if any). Walks the whole parent chain, since groups nest:
 * a node's position is relative to its parent, whose position is in turn
 * relative to ITS parent, and so on up to the canvas. Cycle-safe.
 */
export function toAbsolutePosition(
  node: Pick<Node, 'position'>,
  allNodes: Node[],
  parentId: string | undefined,
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  const visited = new Set<string>();
  let current = parentId;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const parent = allNodes.find((n) => n.id === current);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    current = parent.parentId;
  }
  return { x, y };
}

/**
 * The inverse of toAbsolutePosition: converts a canvas-absolute position into
 * one relative to `parentId` (which may itself be nested). No parent means
 * the position is already what the canvas wants.
 */
export function toRelativePosition(
  absolute: { x: number; y: number },
  allNodes: Node[],
  parentId: string | undefined,
): { x: number; y: number } {
  if (!parentId) return absolute;
  const parent = allNodes.find((n) => n.id === parentId);
  if (!parent) return absolute;
  const parentAbsolute = toAbsolutePosition(parent, allNodes, parent.parentId);
  return { x: absolute.x - parentAbsolute.x, y: absolute.y - parentAbsolute.y };
}

/** Every group containing `nodeId`, nearest first. Cycle-safe. */
export function getAncestorIds(nodeId: string, allNodes: ParentLink[]): string[] {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const ancestors: string[] = [];
  const visited = new Set<string>([nodeId]);
  let current = byId.get(nodeId)?.parentId;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    ancestors.push(current);
    current = byId.get(current)?.parentId;
  }
  return ancestors;
}

/** Whether `nodeId` sits inside `ancestorId` at any depth. */
export function isDescendantOf(
  nodeId: string,
  ancestorId: string,
  allNodes: ParentLink[],
): boolean {
  return getAncestorIds(nodeId, allNodes).includes(ancestorId);
}

/**
 * Every node inside `groupId` at any depth. Built in one pass over a
 * children index, so it is cheap enough to call once per drag frame.
 */
export function getDescendantIds(groupId: string, allNodes: ParentLink[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const n of allNodes) {
    if (n.parentId === undefined) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n.id);
    else childrenOf.set(n.parentId, [n.id]);
  }
  const descendants = new Set<string>();
  const stack = [...(childrenOf.get(groupId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === groupId || descendants.has(id)) continue;
    descendants.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return descendants;
}

/**
 * Narrows the nodes found inside a boundary down to the ones it should
 * actually adopt as DIRECT children.
 *
 * With nested groups, "everything fully inside the rect" is too much: if
 * group B (with its own children) sits inside A, A should adopt B, and B's
 * children should stay B's - they already move with B, so they move with A
 * transitively. Adopting them directly would pull them out of B, and B
 * would then be left behind whenever A moved.
 *
 * Dropped from `candidateIds`:
 *  - the group itself, and any group that contains it (adopting an
 *    ancestor would create a cycle)
 *  - anything already inside the group at any depth (it moves with it)
 *  - anything whose container is also being adopted (it comes along with
 *    that container)
 */
export function selectNodesToAdopt(
  groupId: string,
  candidateIds: string[],
  allNodes: ParentLink[],
): string[] {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const groupAncestors = new Set(getAncestorIds(groupId, allNodes));
  const pool = new Set(
    candidateIds.filter((id) => id !== groupId && !groupAncestors.has(id) && byId.has(id)),
  );
  return [...pool].filter((id) => {
    const visited = new Set<string>([id]);
    let current = byId.get(id)?.parentId;
    while (current !== undefined && !visited.has(current)) {
      if (current === groupId || pool.has(current)) return false;
      visited.add(current);
      current = byId.get(current)?.parentId;
    }
    return true;
  });
}

type SizedNode = ParentLink & {
  type?: string;
  width?: number | null;
  height?: number | null;
  measured?: { width?: number; height?: number };
};

/** A node's area from its explicit or measured size (0 if neither is known yet). */
export function nodeArea(n: Omit<SizedNode, 'id'>): number {
  const w = n.width ?? n.measured?.width ?? 0;
  const h = n.height ?? n.measured?.height ?? 0;
  return w * h;
}

/**
 * Picks the group a dropped node should become a child of, out of the
 * groups it was dropped over. With nested groups, a node dropped inside B
 * (which is inside A) overlaps both - it belongs to the innermost one: the
 * deepest-nested, with the smallest area breaking ties between siblings.
 *
 * The node itself and its own descendants are never candidates, since
 * parenting a group to something inside it would create a cycle.
 */
export function pickInnermostGroup<T extends SizedNode>(
  nodeId: string,
  candidates: T[],
  allNodes: ParentLink[],
): T | undefined {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  let best: { node: T; depth: number; area: number } | undefined;
  for (const c of candidates) {
    if (c.type !== 'group' || c.id === nodeId) continue;
    if (isDescendantOf(c.id, nodeId, allNodes)) continue;
    const depth = containmentDepth(c, byId);
    const area = nodeArea(c);
    if (!best || depth > best.depth || (depth === best.depth && area < best.area)) {
      best = { node: c, depth, area };
    }
  }
  return best?.node;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Checks whether a node is fully contained inside a given bounding rect (in canvas-absolute coordinates).
 */
export function isNodeContainedInRect(
  node: Pick<Node, 'position'> & {
    parentId?: string;
    width?: number;
    height?: number;
    measured?: { width?: number; height?: number };
  },
  allNodes: Node[],
  rect: Rect,
): boolean {
  const absPos = toAbsolutePosition(node, allNodes, node.parentId);
  const w = node.width ?? node.measured?.width ?? 0;
  const h = node.height ?? node.measured?.height ?? 0;
  return (
    absPos.x >= rect.x &&
    absPos.y >= rect.y &&
    absPos.x + w <= rect.x + rect.width &&
    absPos.y + h <= rect.y + rect.height
  );
}

/**
 * Finds the nodes a boundary occupying `rect` should adopt: everything fully
 * inside the rect - boundaries included, since they nest - narrowed by
 * selectNodesToAdopt so that only the outermost enclosed items are returned
 * (a nested boundary's own children stay with it) and nothing already
 * inside `groupIdToExclude` is returned again.
 */
export function findNodesContainedInRect<T extends Node>(
  rect: Rect,
  allNodes: T[],
  groupIdToExclude?: string,
): T[] {
  const contained = allNodes.filter(
    (n) => n.id !== groupIdToExclude && isNodeContainedInRect(n, allNodes, rect),
  );
  if (!groupIdToExclude) return contained;
  const keep = new Set(
    selectNodesToAdopt(
      groupIdToExclude,
      contained.map((n) => n.id),
      allNodes,
    ),
  );
  return contained.filter((n) => keep.has(n.id));
}
