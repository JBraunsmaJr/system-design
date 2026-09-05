import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "../domain/types";

/**
 * DiagramStore is the same kind of seam TeamStore, RequirementsStore, and
 * ProgramIncrementsStore are - a narrow, named-operation contract so a
 * local implementation (this file) and a collaborative, Yjs-backed one
 * (yjsDiagramStore.ts) can be swapped behind it without any consuming
 * code needing to change.
 *
 * This is the hard schema problem the whole collaboration plan flagged
 * from the start: the app's actual model is a RECURSIVE tree - a node's
 * own data can hold a nested SubDiagram, whose nodes can themselves hold
 * further nested SubDiagrams, with no depth limit (see types.ts's
 * ArchNodeData doc comment). Plain nested objects handle that for free;
 * Yjs shared types don't nest as naturally to an unbounded depth the way
 * a plain object tree does.
 *
 * The approach taken here, agreed on before writing any code: FLATTEN
 * the tree into one shared space. Every node and edge across the ENTIRE
 * tree - root plus every nested sub-diagram, at any depth - lives in one
 * flat collection, each tagged with a `parentPath: string[]` (the same
 * shape as the app's existing DiagramPath) recording which level of the
 * tree it belongs to. `getNodesAtPath`/`getEdgesAtPath` filter down to
 * one level on demand - closer to how a database would model a tree
 * (parent-reference rows in one table) than how the in-memory version
 * does today (actual nested objects).
 *
 * A few things confirmed by reading the actual app before designing this,
 * each of which shaped the design:
 *
 *  - Node and edge ids are already globally unique across the WHOLE
 *    tree, not just within their own level - App.tsx's nextId draws from
 *    one shared, module-level counter regardless of nesting depth. That
 *    makes flattening into one id-keyed space safe with no risk of two
 *    different levels' nodes colliding on the same id.
 *
 *  - There is no operation anywhere in the app that moves a node from
 *    one tree level to another after it's created - the only way a node
 *    ends up at a given level is by being created while that level is
 *    the currently-viewed path. That means parentPath is effectively
 *    IMMUTABLE once set, which is a real simplification: there's no
 *    "reparent to a different level" operation to design for at all,
 *    only "create at the level the person is currently viewing."
 *
 *  - React Flow's own `parentId` field (a node visually contained inside
 *    a group/boundary node) is a COMPLETELY SEPARATE concept from
 *    parentPath (which level of the sub-diagram TREE a node lives at,
 *    unrelated to visual grouping). Both are preserved, independently.
 *
 *  - The app distinguishes a node that has an explicitly-opened-but-empty
 *    sub-diagram (drilled into once, nothing added yet) from one that's
 *    never been opened at all - see findLinkedNodes's own doc comment in
 *    subDiagramTree.ts. Since "has any children in the flat space" can't
 *    tell these apart (an opened-but-empty one has no children either
 *    way), this needs its own explicit field rather than being derived.
 *
 *  - Deleting a node with a populated sub-diagram cascades - deleting a
 *    node also has to delete every descendant at any deeper parentPath.
 *    The current (non-flattened) code gets this for free, since a node's
 *    subDiagram is nested inside its own data and removing the node
 *    removes everything nested within it automatically; the flattened
 *    model has to do this explicitly, since descendants are now stored
 *    as separate, sibling entries rather than nested inside the parent.
 *    Deleting a GROUP node (parentId containment, same level) is
 *    different and unrelated - its children are released, not deleted,
 *    exactly as today.
 *
 *  - Selection (selected nodes/edges) is deliberately NOT part of this
 *    schema at all - it's ephemeral, per-person UI state, matching the
 *    plan's own "presence is a separate mechanism, not shared document
 *    state" principle. It stays local exactly as it already is today
 *    (selectedNodeIds/selectedEdgeIds in App.tsx, independent of the
 *    nodes/edges arrays themselves).
 *
 * Scenarios are deliberately out of scope for this store - they're a
 * flat list scoped to the top-level diagram only (see SubDiagram's own
 * doc comment: "Scenarios are intentionally NOT part of this"), so they
 * were never part of the recursive-nesting problem this store solves.
 */
export interface DiagramStore {
  /** Every node across the entire tree, at any depth, each carrying its
   * own parentPath. Use getNodesAtPath to filter to one level. */
  getSnapshot(): { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  subscribe(listener: () => void): () => void;

  /** Creates a new node at the given tree level and returns its id. */
  addNode(parentPath: string[], type: string, position: { x: number; y: number }, data: ArchNodeData): string;
  updateNode(id: string, patch: Partial<ArchNodeData>): void;
  updatePosition(id: string, position: { x: number; y: number }): void;
  updateParentId(id: string, parentId: string | undefined, position: { x: number; y: number }): void;
  updateDimensions(id: string, width: number | undefined, height: number | undefined): void;
  /** Deletes the node, every descendant at any deeper parentPath (its
   * own sub-diagram tree, recursively), and every edge touching any of
   * them - matching the app's existing "populated sub-diagram" cascade,
   * just made explicit here since the flattened model doesn't get it
   * for free the way nesting objects did. Group-child release (a
   * DIFFERENT, same-level concern - see this file's own doc comment)
   * stays the UI layer's responsibility, exactly as it works today,
   * since it depends on absolute-position math this store has no
   * reason to know about. */
  deleteNode(id: string): void;

  addEdge(parentPath: string[], source: string, target: string, data: ArchEdgeData): string;
  updateEdge(id: string, patch: Partial<ArchEdgeData>): void;
  deleteEdge(id: string): void;

  /** Marks a node as having an opened sub-diagram (even if still empty)
   * - see this file's own doc comment on why this can't be derived from
   * whether any children currently exist. */
  markSubDiagramOpened(id: string): void;
}

export function getNodesAtPath(nodes: Node<ArchNodeData>[], path: string[]): Node<ArchNodeData>[] {
  return nodes.filter((n) => arraysEqual((n.data as ArchNodeData & { parentPath?: string[] }).parentPath ?? [], path));
}

export function getEdgesAtPath(edges: Edge<ArchEdgeData>[], path: string[]): Edge<ArchEdgeData>[] {
  return edges.filter((e) => arraysEqual((e.data as ArchEdgeData & { parentPath?: string[] }).parentPath ?? [], path));
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** True if `path` is `ancestorPath` itself, or nested at any depth
 * beneath it - used for the delete cascade (every descendant, at any
 * depth, of the deleted node). */
function isPathAtOrBelow(path: string[], ancestorPrefix: string[]): boolean {
  if (path.length < ancestorPrefix.length) return false;
  return ancestorPrefix.every((v, i) => path[i] === v);
}

export function createLocalDiagramStore(initial?: {
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
}): DiagramStore {
  let nodes: Node<ArchNodeData>[] = initial?.nodes ?? [];
  let edges: Edge<ArchEdgeData>[] = initial?.edges ?? [];
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function nodeParentPath(n: Node<ArchNodeData>): string[] {
    return (n.data as ArchNodeData & { parentPath?: string[] }).parentPath ?? [];
  }

  return {
    getSnapshot: () => ({ nodes, edges }),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addNode: (parentPath, type, position, data) => {
      const id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const node: Node<ArchNodeData> = {
        id,
        type,
        position,
        data: { ...data, parentPath } as ArchNodeData & { parentPath: string[] },
      };
      nodes = [...nodes, node];
      notify();
      return id;
    },

    updateNode: (id, patch) => {
      nodes = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
      notify();
    },

    updatePosition: (id, position) => {
      nodes = nodes.map((n) => (n.id === id ? { ...n, position } : n));
      notify();
    },

    updateParentId: (id, parentId, position) => {
      nodes = nodes.map((n) => (n.id === id ? { ...n, parentId, position } : n));
      notify();
    },

    updateDimensions: (id, width, height) => {
      nodes = nodes.map((n) => (n.id === id ? { ...n, width, height } : n));
      notify();
    },

    deleteNode: (id) => {
      const target = nodes.find((n) => n.id === id);
      if (!target) return;
      const descendantPrefix = [...nodeParentPath(target), id];
      const removedIds = new Set(
        nodes.filter((n) => n.id === id || isPathAtOrBelow(nodeParentPath(n), descendantPrefix)).map((n) => n.id)
      );
      nodes = nodes.filter((n) => !removedIds.has(n.id));
      edges = edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target));
      notify();
    },

    addEdge: (parentPath, source, target, data) => {
      const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const edge: Edge<ArchEdgeData> = {
        id,
        source,
        target,
        type: "typed",
        data: { ...data, parentPath } as ArchEdgeData & { parentPath: string[] },
      };
      edges = [...edges, edge];
      notify();
      return id;
    },

    updateEdge: (id, patch) => {
      edges = edges.map((e) => (e.id === id ? { ...e, data: { ...(e.data as ArchEdgeData), ...patch } } : e));
      notify();
    },

    deleteEdge: (id) => {
      edges = edges.filter((e) => e.id !== id);
      notify();
    },

    markSubDiagramOpened: (id) => {
      nodes = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, hasOpenedSubDiagram: true } } : n));
      notify();
    },
  };
}
