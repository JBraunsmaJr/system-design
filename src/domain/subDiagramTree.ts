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
