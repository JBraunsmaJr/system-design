import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, SubDiagram } from "./types";

export interface CloneIdGenerator {
  nextNodeId: (prefix: string) => string;
  nextEdgeId: () => string;
}

function prefixForType(type: string | undefined): string {
  if (type === "group") return "group";
  if (type === "text") return "text";
  if (type === "shape") return "shape";
  return "node";
}

/**
 * Deep-clones a set of nodes (and the edges between them) with entirely
 * fresh ids at every level - including any nested sub-diagrams, recursively,
 * however deep. This is what makes copy/paste safe: without it, pasting a
 * node that has a sub-diagram would leave two nodes sharing the same nested
 * ids, which is fragile even if nothing visibly breaks immediately.
 *
 * Callers are expected to have already resolved any "orphaned" parentId
 * (a node whose parent isn't part of the set being cloned) down to an
 * absolute position with no parentId - see App.tsx's onCopy, which uses
 * toAbsolutePosition for exactly that before calling this.
 */
export function cloneNodesAndEdges(
  nodes: Node<ArchNodeData>[],
  edges: Edge<ArchEdgeData>[],
  ids: CloneIdGenerator
): { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] } {
  const idMap = new Map<string, string>();

  const remappedNodes = nodes.map((n) => {
    const newId = ids.nextNodeId(prefixForType(n.type));
    idMap.set(n.id, newId);
    return newId;
  });

  const clonedNodes = nodes.map((original, i) => {
    const newParentId = original.parentId ? idMap.get(original.parentId) : undefined;
    const newSubDiagram: SubDiagram | undefined = original.data.subDiagram
      ? cloneSubDiagramDeep(original.data.subDiagram, ids)
      : undefined;
    return {
      ...original,
      id: remappedNodes[i],
      parentId: newParentId,
      selected: false,
      data: { ...original.data, subDiagram: newSubDiagram },
    };
  });

  const clonedEdges = edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: ids.nextEdgeId(),
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      selected: false,
    }));

  return { nodes: clonedNodes, edges: clonedEdges };
}

function cloneSubDiagramDeep(sd: SubDiagram, ids: CloneIdGenerator): SubDiagram {
  const { nodes, edges } = cloneNodesAndEdges(sd.nodes, sd.edges, ids);
  return { nodes, edges };
}
