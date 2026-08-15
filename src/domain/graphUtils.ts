import type { Node } from "@xyflow/react";

/**
 * React Flow requires a parent node to appear before its children in the
 * nodes array. Groups in this app never nest inside other groups (single
 * level only), so the invariant reduces to "all group nodes first" - stable
 * otherwise, so this is safe to call after every add/reparent.
 */
export function reorderWithGroupsFirst<T extends { type?: string }>(nodes: T[]): T[] {
  const groups = nodes.filter((n) => n.type === "group");
  const rest = nodes.filter((n) => n.type !== "group");
  return [...groups, ...rest];
}

/** Converts a node's position to canvas-absolute coordinates, given its current parent (if any). */
export function toAbsolutePosition(
  node: Pick<Node, "position">,
  allNodes: Node[],
  parentId: string | undefined
): { x: number; y: number } {
  if (!parentId) return node.position;
  const parent = allNodes.find((n) => n.id === parentId);
  if (!parent) return node.position;
  return { x: node.position.x + parent.position.x, y: node.position.y + parent.position.y };
}
