import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, SubDiagram } from "../domain/types";
import { updateSubDiagramAtPath } from "../domain/subDiagramTree";
import type { DiagramStore } from "./diagramStore";

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
 * not merely a subDiagram field existing). An earlier version of this
 * file invented a separate hasOpenedSubDiagram flag for an "opened but
 * empty" state that turned out not to exist anywhere in the real app -
 * getSubDiagramAtPath is purely read-side and never writes an empty
 * subDiagram back when drilling into a never-populated node, so there
 * was nothing to actually derive that flag from correctly. Removed
 * rather than left as unused, inaccurate scaffolding.
 */
export function createAdapterDiagramStore(
  getRoot: () => SubDiagram,
  setRoot: (updater: (prev: SubDiagram) => SubDiagram) => void
): DiagramStore {
  function flatten(root: SubDiagram): { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] } {
    const nodes: Node<ArchNodeData>[] = [];
    const edges: Edge<ArchEdgeData>[] = [];
    function walk(sd: SubDiagram, path: string[]) {
      for (const node of sd.nodes) {
        const { subDiagram, ...restData } = node.data;
        nodes.push({
          ...node,
          data: { ...restData, parentPath: path } as ArchNodeData,
        });
        if (subDiagram) walk(subDiagram, [...path, node.id]);
      }
      for (const edge of sd.edges) {
        edges.push({ ...edge, data: { ...(edge.data as ArchEdgeData), parentPath: path } as ArchEdgeData });
      }
    }
    walk(root, []);
    return { nodes, edges };
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

  return {
    getSnapshot: () => flatten(getRoot()),

    subscribe: () => () => {},

    addNode: (parentPath, type, position, data) => {
      const id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      // parentPath is implicit in tree position here (it's what
      // updateSubDiagramAtPath's own target path already encodes), so
      // it's deliberately NOT stored on the node's own data field the
      // way the flattened schema stores it - re-derived on every read
      // by flatten() instead, from whichever level the node actually
      // ends up nested at in the real tree.
      const newNode: Node<ArchNodeData> = { id, type, position, data };
      setRoot((root) =>
        updateSubDiagramAtPath(root, parentPath, (sd) => ({ ...sd, nodes: [...sd.nodes, newNode] }))
      );
      return id;
    },

    updateNode: (id, patch) => {
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
      setRoot((root) => {
        const found = findNodePath(root, id);
        if (!found) return root;
        return updateSubDiagramAtPath(root, found.path, (sd) => ({
          ...sd,
          nodes: sd.nodes.map((n) => (n.id === id ? { ...n, width, height } : n)),
        }));
      });
    },

    // Removing the node from its own level automatically takes its
    // entire nested subDiagram (if any) along with it, for free - the
    // exact same "nesting objects gets the cascade for free" property
    // the flattened schema's own equivalent operation has to do
    // explicitly instead (see diagramStore.ts's own doc comment on
    // this). Edges at the SAME level touching the deleted node are
    // removed too; edges belonging to whatever was nested inside it
    // are already gone along with that nested subDiagram itself.
    deleteNode: (id) => {
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

    addEdge: (parentPath, source, target, data) => {
      const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const newEdge: Edge<ArchEdgeData> = { id, source, target, type: "typed", data };
      setRoot((root) =>
        updateSubDiagramAtPath(root, parentPath, (sd) => ({ ...sd, edges: [...sd.edges, newEdge] }))
      );
      return id;
    },

    updateEdge: (id, patch) => {
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
      setRoot((root) => {
        const path = findEdgePath(root, id);
        if (path === null) return root;
        return updateSubDiagramAtPath(root, path, (sd) => ({ ...sd, edges: sd.edges.filter((e) => e.id !== id) }));
      });
    },
  };
}
