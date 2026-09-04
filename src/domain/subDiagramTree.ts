import type { ArchNodeData, SubDiagram } from "./types";

/**
 * `path` is a stack of node ids representing how deep you've drilled in -
 * e.g. ["orders-svc", "request-handler"] means "inside orders-svc's
 * sub-diagram, then inside request-handler's sub-diagram within that."
 * An empty path means the top-level diagram.
 */
export type DiagramPath = string[];

const EMPTY_SUB_DIAGRAM: SubDiagram = { nodes: [], edges: [] };

/** Returns the SubDiagram currently being viewed, given the full tree and a path into it. */
export function getSubDiagramAtPath(root: SubDiagram, path: DiagramPath): SubDiagram {
  let current = root;
  for (const nodeId of path) {
    const node = current.nodes.find((n) => n.id === nodeId);
    current = node?.data.subDiagram ?? EMPTY_SUB_DIAGRAM;
  }
  return current;
}

/**
 * Returns a new tree with the SubDiagram at `path` replaced by
 * `updater(currentSubDiagramAtThatPath)` - an immutable "lens" update that
 * only reconstructs the chain of nodes from root down to `path`, leaving
 * every sibling subtree untouched (and therefore referentially unchanged,
 * which keeps React re-renders cheap).
 */
export function updateSubDiagramAtPath(
  root: SubDiagram,
  path: DiagramPath,
  updater: (sd: SubDiagram) => SubDiagram
): SubDiagram {
  if (path.length === 0) {
    return updater(root);
  }
  const [headId, ...rest] = path;
  return {
    ...root,
    nodes: root.nodes.map((n) => {
      if (n.id !== headId) return n;
      const childSubDiagram: SubDiagram = n.data.subDiagram ?? EMPTY_SUB_DIAGRAM;
      const updatedChild = updateSubDiagramAtPath(childSubDiagram, rest, updater);
      return { ...n, data: { ...n.data, subDiagram: updatedChild } satisfies ArchNodeData };
    }),
  };
}

/** Resolves each path segment's current label, e.g. ["Orders Service", "Request Handling"]. */
export function getBreadcrumbLabels(root: SubDiagram, path: DiagramPath): string[] {
  const labels: string[] = [];
  let current = root;
  for (const nodeId of path) {
    const node = current.nodes.find((n) => n.id === nodeId);
    labels.push(node?.data.label ?? "Untitled");
    current = node?.data.subDiagram ?? EMPTY_SUB_DIAGRAM;
  }
  return labels;
}

export interface LinkedNodeRef {
  nodeId: string;
  label: string;
  /** Path to navigate TO in order to REACH the sub-diagram containing this
   * node - i.e. setPath to this value and the node itself is then visible
   * at that level. This is NOT the path into the node's own sub-diagram
   * (that would be [...path, nodeId]). */
  path: DiagramPath;
  /** True only when the node's sub-diagram actually has content - a node
   * that was double-clicked open once but never populated still has a
   * subDiagram object (an empty one), which isn't "supporting
   * documentation" worth surfacing a link to. */
  hasSubDiagram: boolean;
}

/**
 * Finds every node across the ENTIRE tree - root plus every nested
 * sub-diagram, at any depth - whose linkedRequirementIds includes
 * `itemId`. This is the reverse of what the Inspector's RequirementLinker
 * already does (node -> requirement); there was no existing mechanism for
 * requirement -> node, since a node can only be reached via its
 * ancestors' path, not looked up directly by id. Verified against 10
 * cases - including a node with an id matching a DIFFERENT item, a
 * multi-level-deep match, and the empty-vs-populated subDiagram
 * distinction - before wiring this into any UI.
 */
export function findLinkedNodes(root: SubDiagram, itemId: string): LinkedNodeRef[] {
  const results: LinkedNodeRef[] = [];
  function walk(sd: SubDiagram, currentPath: DiagramPath) {
    for (const node of sd.nodes) {
      if (node.data.linkedRequirementIds?.includes(itemId)) {
        results.push({
          nodeId: node.id,
          label: node.data.label,
          path: currentPath,
          hasSubDiagram: (node.data.subDiagram?.nodes.length ?? 0) > 0,
        });
      }
      if (node.data.subDiagram) {
        walk(node.data.subDiagram, [...currentPath, node.id]);
      }
    }
  }
  walk(root, []);
  return results;
}

/**
 * Batched version of findLinkedNodes - walks the diagram tree exactly
 * ONCE and returns every item's linked nodes in a single map, instead of
 * each caller independently re-walking the whole tree for its own item.
 *
 * This exists because RequirementsView renders one RequirementCard per
 * requirement item, and each card originally called findLinkedNodes
 * itself - with N items and a diagram of M total nodes across every
 * nested sub-diagram, that's O(N*M) work just to render the list once,
 * repeated on every diagram change. RequirementDetailModal (the
 * single-item detail modal used by Timeline and the Skill Tree) still
 * calls findLinkedNodes directly and correctly - it only ever shows one
 * item at a time, so there's no list-wide cost to batch away there; this
 * function is specifically for list views with many items.
 *
 * An item with no linked nodes has no entry in the returned map at all
 * (not an empty array entry) - callers already read this the same way
 * findLinkedNodes's own empty-array result is read, via `?? []`.
 * Verified to produce results identical to calling findLinkedNodes
 * per-item, and to visit each sub-diagram exactly once regardless of how
 * many items are being looked up, before wiring this in.
 */
export function findAllLinkedNodes(root: SubDiagram): Map<string, LinkedNodeRef[]> {
  const result = new Map<string, LinkedNodeRef[]>();
  function walk(sd: SubDiagram, currentPath: DiagramPath) {
    for (const node of sd.nodes) {
      for (const itemId of node.data.linkedRequirementIds ?? []) {
        const list = result.get(itemId) ?? [];
        list.push({
          nodeId: node.id,
          label: node.data.label,
          path: currentPath,
          hasSubDiagram: (node.data.subDiagram?.nodes.length ?? 0) > 0,
        });
        result.set(itemId, list);
      }
      if (node.data.subDiagram) {
        walk(node.data.subDiagram, [...currentPath, node.id]);
      }
    }
  }
  walk(root, []);
  return result;
}
