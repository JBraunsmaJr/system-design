import * as Y from "yjs";
import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "../domain/types";
import type { DiagramStore } from "./diagramStore";

/** Node and edge ids are purely internal (never displayed - React Flow
 * uses them as keys and connection endpoints, nothing more), so - same
 * reasoning as program increments' PI/sprint ids - there's no reason not
 * to make them fully collision-resistant from the start rather than
 * needing anything like requirements' id-collision repair pass. */
function collisionResistantId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const NODE_DATA_FIELDS = [
  "nodeType",
  "label",
  "description",
  "properties",
  "tags",
  "textColor",
  "fontSize",
  "color",
  "icon",
  "codeContent",
  "codeLanguage",
  "linkedRequirementIds",
  "hasOpenedSubDiagram",
] as const;

const EDGE_DATA_FIELDS = [
  "edgeType",
  "label",
  "direction",
  "hideLabel",
  "color",
  "labelAnchorT",
  "labelOffsetX",
  "labelOffsetY",
  "properties",
] as const;

/**
 * Yjs-backed DiagramStore. See diagramStore.ts for the full rationale
 * behind the flattened schema (every node/edge across the whole
 * recursive tree in one flat, id-keyed space, tagged with a parentPath);
 * this file is just the Yjs mechanics of that same design.
 *
 * Schema (all on the given Y.Doc):
 *  - "nodeOrder": Y.Array<string> - every node's id, across the ENTIRE
 *    tree at any depth, in one flat order.
 *  - "nodes": Y.Map<string, Y.Map> - keyed by node id. Each value is a
 *    nested Y.Map (updateNode/updatePosition/updateParentId/
 *    updateDimensions are all separate, independent field-patch
 *    operations - the same "field-level patch operation exists" signal
 *    used everywhere else in this codebase to mean nesting, not a plain
 *    value, is needed) holding: type, position, parentId, width,
 *    height, parentPath (plain array value - immutable once set, see
 *    diagramStore.ts), and every ArchNodeData field (label, description,
 *    properties, tags, etc. - see NODE_DATA_FIELDS) as its own key.
 *  - "edgeOrder" / "edges": same pattern for edges - source, target,
 *    type, parentPath, plus every ArchEdgeData field (see
 *    EDGE_DATA_FIELDS).
 *
 * properties (on both nodes and edges) stays a plain Record<string,
 * string> value rather than a further-nested Y.Map, matching the same
 * reasoning already applied to team's extraDaysOff and requirements'
 * categories: the Inspector's key-value editor replaces the whole object
 * on each edit today, so there's no existing field-level-patch operation
 * to protect with nesting.
 */
export function createYjsDiagramStore(doc: Y.Doc): DiagramStore {
  const nodeOrder = doc.getArray<string>("nodeOrder");
  const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
  const edgeOrder = doc.getArray<string>("edgeOrder");
  const edgesMap = doc.getMap<Y.Map<unknown>>("edges");

  function nodeMapToPlain(id: string, m: Y.Map<unknown>): Node<ArchNodeData> {
    const data: Record<string, unknown> = { parentPath: m.get("parentPath") as string[] };
    for (const field of NODE_DATA_FIELDS) data[field] = m.get(field);
    const node: Node<ArchNodeData> = {
      id,
      type: m.get("type") as string,
      position: m.get("position") as { x: number; y: number },
      data: data as ArchNodeData,
    };
    const parentId = m.get("parentId") as string | undefined;
    if (parentId !== undefined) node.parentId = parentId;
    const width = m.get("width") as number | undefined;
    if (width !== undefined) node.width = width;
    const height = m.get("height") as number | undefined;
    if (height !== undefined) node.height = height;
    return node;
  }

  function edgeMapToPlain(id: string, m: Y.Map<unknown>): Edge<ArchEdgeData> {
    const data: Record<string, unknown> = { parentPath: m.get("parentPath") as string[] };
    for (const field of EDGE_DATA_FIELDS) data[field] = m.get(field);
    return {
      id,
      source: m.get("source") as string,
      target: m.get("target") as string,
      type: m.get("type") as string,
      data: data as ArchEdgeData,
    };
  }

  function buildSnapshot(): { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] } {
    return {
      nodes: nodeOrder
        .toArray()
        .map((id) => {
          const m = nodesMap.get(id);
          return m ? nodeMapToPlain(id, m) : null;
        })
        .filter((n): n is Node<ArchNodeData> => n !== null),
      edges: edgeOrder
        .toArray()
        .map((id) => {
          const m = edgesMap.get(id);
          return m ? edgeMapToPlain(id, m) : null;
        })
        .filter((e): e is Edge<ArchEdgeData> => e !== null),
    };
  }

  let cached = buildSnapshot();
  const listeners = new Set<() => void>();
  const recomputeAndNotify = () => {
    cached = buildSnapshot();
    for (const listener of listeners) listener();
  };

  nodeOrder.observeDeep(recomputeAndNotify);
  nodesMap.observeDeep(recomputeAndNotify);
  edgeOrder.observeDeep(recomputeAndNotify);
  edgesMap.observeDeep(recomputeAndNotify);

  function isPathAtOrBelow(path: string[], ancestorPrefix: string[]): boolean {
    if (path.length < ancestorPrefix.length) return false;
    return ancestorPrefix.every((v, i) => path[i] === v);
  }

  return {
    getSnapshot: () => cached,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addNode: (parentPath, type, position, data) => {
      const id = collisionResistantId("node");
      doc.transact(() => {
        const m = new Y.Map<unknown>();
        m.set("type", type);
        m.set("position", position);
        m.set("parentPath", parentPath);
        for (const field of NODE_DATA_FIELDS) {
          m.set(field, (data as Record<string, unknown>)[field]);
        }
        nodesMap.set(id, m);
        nodeOrder.push([id]);
      });
      return id;
    },

    updateNode: (id, patch) => {
      const m = nodesMap.get(id);
      if (!m) return;
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          m.set(key, value);
        }
      });
    },

    updatePosition: (id, position) => {
      const m = nodesMap.get(id);
      if (m) m.set("position", position);
    },

    updateParentId: (id, parentId, position) => {
      const m = nodesMap.get(id);
      if (!m) return;
      doc.transact(() => {
        m.set("parentId", parentId);
        m.set("position", position);
      });
    },

    updateDimensions: (id, width, height) => {
      const m = nodesMap.get(id);
      if (!m) return;
      doc.transact(() => {
        m.set("width", width);
        m.set("height", height);
      });
    },

    deleteNode: (id) => {
      const targetM = nodesMap.get(id);
      if (!targetM) return;
      const targetParentPath = (targetM.get("parentPath") as string[]) ?? [];
      const descendantPrefix = [...targetParentPath, id];

      const removedIds = new Set<string>([id]);
      for (const nid of nodeOrder.toArray()) {
        if (nid === id) continue;
        const m = nodesMap.get(nid);
        const path = (m?.get("parentPath") as string[]) ?? [];
        if (isPathAtOrBelow(path, descendantPrefix)) removedIds.add(nid);
      }

      doc.transact(() => {
        for (const nid of removedIds) {
          nodesMap.delete(nid);
          const idx = nodeOrder.toArray().indexOf(nid);
          if (idx !== -1) nodeOrder.delete(idx, 1);
        }
        for (const eid of edgeOrder.toArray()) {
          const em = edgesMap.get(eid);
          if (!em) continue;
          if (removedIds.has(em.get("source") as string) || removedIds.has(em.get("target") as string)) {
            edgesMap.delete(eid);
            const idx = edgeOrder.toArray().indexOf(eid);
            if (idx !== -1) edgeOrder.delete(idx, 1);
          }
        }
      });
    },

    addEdge: (parentPath, source, target, data) => {
      const id = collisionResistantId("edge");
      doc.transact(() => {
        const m = new Y.Map<unknown>();
        m.set("source", source);
        m.set("target", target);
        m.set("type", "typed");
        m.set("parentPath", parentPath);
        for (const field of EDGE_DATA_FIELDS) {
          m.set(field, (data as Record<string, unknown>)[field]);
        }
        edgesMap.set(id, m);
        edgeOrder.push([id]);
      });
      return id;
    },

    updateEdge: (id, patch) => {
      const m = edgesMap.get(id);
      if (!m) return;
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          m.set(key, value);
        }
      });
    },

    deleteEdge: (id) => {
      doc.transact(() => {
        edgesMap.delete(id);
        const idx = edgeOrder.toArray().indexOf(id);
        if (idx !== -1) edgeOrder.delete(idx, 1);
      });
    },

    markSubDiagramOpened: (id) => {
      const m = nodesMap.get(id);
      if (m) m.set("hasOpenedSubDiagram", true);
    },
  };
}
