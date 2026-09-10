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
  node: Pick<Node, "position"> & {
    parentId?: string;
    width?: number;
    height?: number;
    measured?: { width?: number; height?: number };
  },
  allNodes: Node[],
  rect: Rect
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
 * Finds all nodes that are fully contained inside a given rect, excluding groups and nodes already parented to the target group.
 */
export function findNodesContainedInRect<T extends Node>(
  rect: Rect,
  allNodes: T[],
  groupIdToExclude?: string
): T[] {
  return allNodes.filter((n) => {
    if (groupIdToExclude && (n.id === groupIdToExclude || n.parentId === groupIdToExclude)) {
      return false;
    }
    if (n.type === "group") {
      return false;
    }
    return isNodeContainedInRect(n, allNodes, rect);
  });
}
