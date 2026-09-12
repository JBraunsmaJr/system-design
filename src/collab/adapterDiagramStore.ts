import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, SubDiagram } from "../domain/types";
import { updateSubDiagramAtPath } from "../domain/subDiagramTree";
import type { DiagramStore } from "./diagramStore";
import {
  flattenSubDiagramTree,
  withWaypointAdded,
  withWaypointMoved,
  withWaypointRemoved,
  withWaypointsCleared,
} from "./diagramStore";
import { recordSnapshotBuild, recordStoreWrite } from "../perf/instrumentation";

/**
 * A DiagramStore that owns no state of its own - same purpose as
 * createAdapterTeamStore/createAdapterRequirementsStore/
 * createAdapterProgramIncrementsStore, but structurally different from
 * all three of those, because the diagram's ACTUAL current
 * representation in App.tsx (root: SubDiagram, a recursive tree where a
 * node's own data can hold a nested SubDiagram) doesn't match
 * DiagramStore's flat, parentPath-tagged schema at all. Those three
 * other adapters translate named operations into inline transforms of
 * an already-flat-ish object; this one translates them into
 * recursive-tree operations, using the tree's own existing
 * getSubDiagramAtPath/updateSubDiagramAtPath lenses (subDiagramTree.ts)
 * to read and write at whatever level a given node or edge actually
 * lives at.
 *
 * getSnapshot flattens the WHOLE tree - root plus every nested
 * sub-diagram, at any depth - into the flat shape DiagramStore expects,
 * tagging each node/edge with the parentPath its position in the real
 * tree corresponds to. The various update/delete operations do the
 * reverse: given an id, they first find WHICH level of the tree it
 * actually lives at (findNodePath/findEdgePath, both O(total nodes) in
 * the worst case - acceptable for realistic diagram sizes, not
 * optimized further here), then apply the change there via
 * updateSubDiagramAtPath.
 *
 * Whether a node "has a sub-diagram" is never baked into the flattened
 * data here - it's derived on demand via diagramStore.ts's own
 * hasSubDiagram helper (itself matching the real app's existing
 * definition in findLinkedNodes: at least one node one level deeper,
 * not merely a subDiagram field existing).
 */
export function createAdapterDiagramStore(
  getRoot: () => SubDiagram,
  setRoot: (updater: (prev: SubDiagram) => SubDiagram) => void
): DiagramStore {
  /**
   * getSnapshot must return the exact same reference when called repeatedly with nothing having
   * actually changed - this useSyncExternalStore's own contract, not an optional optimization:
   *
   * Violating it means React sees a "new" snapshot on every single render (even though the data is identical).
   *
   * This is why we cache the flattened result - to prevent infinite looping.
   */
  let cachedRoot: SubDiagram | null = null;
  let cachedSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] } | null = null;
  function getSnapshot() {
    const root = getRoot();
    if (root !== cachedRoot) {
      cachedRoot = root;
      cachedSnapshot = flattenSubDiagramTree(root);
      recordSnapshotBuild();
    }
    return cachedSnapshot!;
  }

  /** Finds the tree path a node with the given id actually lives at,
   * along with the node itself as currently stored in the tree
   * (including its real `subDiagram` field, unlike the flattened
   * version returned by getSnapshot). Returns null if no such node
   * exists anywhere in the tree. */
  function findNodePath(root: SubDiagram, id: string): { path: string[]; node: Node<ArchNodeData> } | null {
    function walk(sd: SubDiagram, path: string[]): { path: string[]; node: Node<ArchNodeData> } | null {
      for (const node of sd.nodes) {
        if (node.id === id) return { path, node };
        if (node.data.subDiagram) {
          const found = walk(node.data.subDiagram, [...path, node.id]);
          if (found) return found;
        }
      }
      return null;
    }
    return walk(root, []);
  }

  function findEdgePath(root: SubDiagram, id: string): string[] | null {
    function walk(sd: SubDiagram, path: string[]): string[] | null {
      if (sd.edges.some((e) => e.id === id)) return path;
      for (const node of sd.nodes) {
        if (node.data.subDiagram) {
          const found = walk(node.data.subDiagram, [...path, node.id]);
          if (found) return found;
        }
      }
      return null;
    }
    return walk(root, []);
  }


  /** Locates whichever level of the tree an edge actually lives at and
   * replaces it there - the find-then-update dance every one of the
   * operations above otherwise repeats verbatim. */
  function updateEdgeInTree(id: string, transform: (edge: Edge<ArchEdgeData>) => Edge<ArchEdgeData>): void {
    setRoot((root) => {
      const path = findEdgePath(root, id);
      if (path === null) return root;
      return updateSubDiagramAtPath(root, path, (sd) => ({
        ...sd,
        edges: sd.edges.map((e) => (e.id === id ? transform(e) : e)),
      }));
    });
  }

  return {
    getSnapshot,

    subscribe: () => () => {},

    addNode: (parentPath, type, position, data) => {
      recordStoreWrite();
      const id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      /**
       * parentPath is implicit in tree position here (it's what
       * updateSubDiagramAtPath's own target path already encodes), so
       * it's deliberately NOT stored on the node's own data field the
       * way the flattened schema stores it - re-derived on every read
       * by flattenSubDiagramTree instead, from whichever level the node ends
       * up nested at the real tree.
       */
      const newNode: Node<ArchNodeData> = { id, type, position, data };
      setRoot((root) =>
        updateSubDiagramAtPath(root, parentPath, (sd) => ({ ...sd, nodes: [...sd.nodes, newNode] }))
      );
      return id;
    },

    updateNode: (id, patch) => {
      recordStoreWrite();
      setRoot((root) => {
        const found = findNodePath(root, id);
        if (!found) return root;
        return updateSubDiagramAtPath(root, found.path, (sd) => ({
          ...sd,
          nodes: sd.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
        }));
      });
    },

    updatePosition: (id, position) => {
      recordStoreWrite();
      setRoot((root) => {
        const found = findNodePath(root, id);
        if (!found) return root;
        return updateSubDiagramAtPath(root, found.path, (sd) => ({
          ...sd,
          nodes: sd.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
        }));
      });
    },

    updateParentId: (id, parentId, position) => {
      recordStoreWrite();
      setRoot((root) => {
        const found = findNodePath(root, id);
        if (!found) return root;
        return updateSubDiagramAtPath(root, found.path, (sd) => ({
          ...sd,
          nodes: sd.nodes.map((n) => (n.id === id ? { ...n, parentId, position } : n)),
        }));
      });
    },

    updateDimensions: (id, width, height) => {
      recordStoreWrite();
      setRoot((root) => {
        const found = findNodePath(root, id);
        if (!found) return root;
        return updateSubDiagramAtPath(root, found.path, (sd) => ({
          ...sd,
          nodes: sd.nodes.map((n) => (n.id === id ? { ...n, width, height } : n)),
        }));
      });
    },

    /**
     * Removing the node from its own level automatically takes its entire
     * nested subDiagram (if any) along with it, for free - the exact same "nesting objects gets
     * the cascade for free" property the flattened schema's own equivalent operation has to
     * do explicitly instead. Edges at the same level touching the deleted node are
     * removed too; edges belonging to whatever was nested inside it are already gone
     * with that nested subDiagram itself.
     * @param id
     */
    deleteNode: (id) => {
      recordStoreWrite();
      setRoot((root) => {
        const found = findNodePath(root, id);
        if (!found) return root;
        return updateSubDiagramAtPath(root, found.path, (sd) => ({
          ...sd,
          nodes: sd.nodes.filter((n) => n.id !== id),
          edges: sd.edges.filter((e) => e.source !== id && e.target !== id),
        }));
      });
    },

    addEdge: (parentPath, source, target, data, sourceHandle, targetHandle) => {
      recordStoreWrite();
      const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const newEdge: Edge<ArchEdgeData> = { id, source, target, sourceHandle, targetHandle, type: "typed", data };
      setRoot((root) =>
        updateSubDiagramAtPath(root, parentPath, (sd) => ({ ...sd, edges: [...sd.edges, newEdge] }))
      );
      return id;
    },

    updateEdge: (id, patch) => {
      recordStoreWrite();
      setRoot((root) => {
        const path = findEdgePath(root, id);
        if (path === null) return root;
        return updateSubDiagramAtPath(root, path, (sd) => ({
          ...sd,
          edges: sd.edges.map((e) => (e.id === id ? { ...e, data: { ...(e.data as ArchEdgeData), ...patch } } : e)),
        }));
      });
    },

    deleteEdge: (id) => {
      recordStoreWrite();
      setRoot((root) => {
        const path = findEdgePath(root, id);
        if (path === null) return root;
        return updateSubDiagramAtPath(root, path, (sd) => ({ ...sd, edges: sd.edges.filter((e) => e.id !== id) }));
      });
    },

    reconnectEdge: (id, endpoints) => {
      recordStoreWrite();
      updateEdgeInTree(id, (edge) => ({
        ...edge,
        source: endpoints.source,
        target: endpoints.target,
        sourceHandle: endpoints.sourceHandle ?? null,
        targetHandle: endpoints.targetHandle ?? null,
      }));
    },

    // The four waypoint operations share their transforms with the local
    // store (see diagramStore.ts) rather than reimplementing them, so
    // the two representations that hold waypoints as a plain array can't
    // drift apart on the details - particularly the "drop the key when
    // the last bend goes" rule, which is easy to get subtly wrong twice.
    addEdgeWaypoint: (edgeId, index, waypoint) => {
      recordStoreWrite();
      updateEdgeInTree(edgeId, (edge) => ({
        ...edge,
        data: withWaypointAdded(edge.data as ArchEdgeData, index, waypoint),
      }));
    },

    moveEdgeWaypoint: (edgeId, waypointId, position) => {
      recordStoreWrite();
      updateEdgeInTree(edgeId, (edge) => ({
        ...edge,
        data: withWaypointMoved(edge.data as ArchEdgeData, waypointId, position),
      }));
    },

    removeEdgeWaypoint: (edgeId, waypointId) => {
      recordStoreWrite();
      updateEdgeInTree(edgeId, (edge) => ({
        ...edge,
        data: withWaypointRemoved(edge.data as ArchEdgeData, waypointId),
      }));
    },

    clearEdgeWaypoints: (edgeId) => {
      recordStoreWrite();
      updateEdgeInTree(edgeId, (edge) => ({
        ...edge,
        data: withWaypointsCleared(edge.data as ArchEdgeData),
      }));
    },
  };
}
