import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, ArchEdgeDataPatch, EdgeWaypoint, SubDiagram } from "../domain/types";
import type { EdgeEndpoints } from "../domain/edgeReconnect";
import { recordUnflattenCall, recordStoreWrite } from "../perf/instrumentation";

/**
 * DiagramStore is the same kind of seam TeamStore, RequirementsStore, and
 * ProgramIncrementsStore are - a narrow, named-operation contract so a
 * local implementation (this file) and a collaborative, Yjs-backed one
 * (yjsDiagramStore.ts) can be swapped behind it without any consuming
 * code needing to change.
 *
 * The actual model is a recursive tree, a node's own data can hold a nested
 * SubDiagram, whose nodes can themselves hold further nested SubDiagrams, with no depth
 * limit. Plain nested objects handle that for free; Yjs shared types don't nest
 * as naturally to an unbound depth the way a plain object tree does.
 *
 * The approach taken here: Flatten the tree into one shared space. Every
 * node and edge across the entire tree - root plus every nested sub-diagram, at any depth - lives
 * in one flat collection, each tagged with a `parentPath: string[]` (the same
 * shape as the app's existing DiagramPath) recording which level of the tree it
 * belongs to. `getNodesAtPath`/`getEdgesAtPath` filter down to one level
 * on demand - closer to how a database would model a tree (parent-reference rows
 * in one table) than how the in-memory version does today (actual nested objects).
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

  /** sourceHandle/targetHandle matter here: several node types define
   * multiple named handles (see BidirectionalHandles.tsx), so which
   * specific handle a connection was made from/to is real, meaningful
   * data - not something that can be left to default to "the only
   * handle" the way a simpler node might get away with. Only ever set
   * at creation time (via onConnect) - nothing in the app changes them
   * on an already-created edge afterward, so updateEdge has no
   * equivalent need for them. */
  addEdge(
    parentPath: string[],
    source: string,
    target: string,
    data: ArchEdgeData,
    sourceHandle?: string | null,
    targetHandle?: string | null
  ): string;
  updateEdge(id: string, patch: ArchEdgeDataPatch): void;
  deleteEdge(id: string): void;

  /**
   * Moves one or both of an edge's ends onto different nodes/handles -
   * draw.io-style endpoint dragging.
   *
   * Its own operation rather than part of updateEdge because
   * source/target/sourceHandle/targetHandle are top-level React Flow
   * Edge fields, not ArchEdgeData fields, so updateEdge's
   * ArchEdgeDataPatch can't express them at all. (The note on
   * addEdge above, that nothing changes an edge's handles after
   * creation, is what this operation changes.)
   *
   * All four fields move together in ONE transaction. Half-applied
   * endpoints - a new target with the old source - is a state that
   * should never be observable by a peer, and in the Yjs implementation
   * a transaction is what guarantees that.
   */
  reconnectEdge(id: string, endpoints: EdgeEndpoints): void;

  /** Inserts a bend at `index` in the edge's waypoint order (0 puts it
   * between the source and the first existing bend). */
  addEdgeWaypoint(edgeId: string, index: number, waypoint: EdgeWaypoint): void;

  /**
   * Moves an existing bend. By waypoint ID, not by index, and this is
   * the single most important detail in the whole waypoint design.
   *
   * A drag is a stream of these calls, one per pointermove. If they were
   * index-addressed and a collaborator inserted or removed a bend
   * earlier in the same edge partway through that drag, every index
   * after theirs shifts by one - and the rest of the drag would silently
   * start moving a DIFFERENT bend than the one under the cursor. Ids
   * don't shift, so the drag keeps hold of the bend it started on no
   * matter what else arrives mid-gesture.
   */
  moveEdgeWaypoint(edgeId: string, waypointId: string, position: { x: number; y: number }): void;

  /** Removes a single bend by id - same identity-over-index reasoning as
   * moveEdgeWaypoint. */
  removeEdgeWaypoint(edgeId: string, waypointId: string): void;

  /** Drops every bend, returning the edge to automatic routing. */
  clearEdgeWaypoints(edgeId: string): void;
}

/**
 * The waypoint transforms, written once against a plain ArchEdgeData
 * and shared by the local store and the tree adapter - the two
 * implementations that hold waypoints as an ordinary JS array. (The Yjs
 * store deliberately does NOT use these: its whole point is that it
 * holds waypoints as real shared types instead, so it implements the
 * same four operations directly against those.)
 *
 * All four keep one invariant that matters beyond tidiness: when no
 * waypoints remain, the `waypoints` KEY is removed entirely rather than
 * left as an empty array. An edge that has never been bent and an edge
 * whose bends were all removed should be indistinguishable - both in the
 * saved file, and in diagramStore.verify.ts's own check that the local
 * and Yjs stores produce edge data with the identical set of keys.
 */
export function withWaypointAdded(data: ArchEdgeData, index: number, waypoint: EdgeWaypoint): ArchEdgeData {
  const current = data.waypoints ?? [];
  const clamped = Math.max(0, Math.min(index, current.length));
  const next = [...current.slice(0, clamped), waypoint, ...current.slice(clamped)];
  return { ...data, waypoints: next };
}

export function withWaypointMoved(
  data: ArchEdgeData,
  waypointId: string,
  position: { x: number; y: number }
): ArchEdgeData {
  const current = data.waypoints ?? [];
  if (!current.some((w) => w.id === waypointId)) return data;
  return {
    ...data,
    waypoints: current.map((w) => (w.id === waypointId ? { ...w, x: position.x, y: position.y } : w)),
  };
}

export function withWaypointRemoved(data: ArchEdgeData, waypointId: string): ArchEdgeData {
  const current = data.waypoints ?? [];
  const next = current.filter((w) => w.id !== waypointId);
  if (next.length === current.length) return data;
  return withWaypointsOrNone(data, next);
}

export function withWaypointsCleared(data: ArchEdgeData): ArchEdgeData {
  if (data.waypoints === undefined) return data;
  return withWaypointsOrNone(data, []);
}

function withWaypointsOrNone(data: ArchEdgeData, waypoints: EdgeWaypoint[]): ArchEdgeData {
  if (waypoints.length > 0) return { ...data, waypoints };
  const rest = { ...data };
  delete rest.waypoints;
  return rest;
}

export function getNodesAtPath(nodes: Node<ArchNodeData>[], path: string[]): Node<ArchNodeData>[] {
  return nodes.filter((n) => arraysEqual((n.data as ArchNodeData & { parentPath?: string[] }).parentPath ?? [], path));
}

export function getEdgesAtPath(edges: Edge<ArchEdgeData>[], path: string[]): Edge<ArchEdgeData>[] {
  return edges.filter((e) => arraysEqual((e.data as ArchEdgeData & { parentPath?: string[] }).parentPath ?? [], path));
}

/** True if `nodeId` (itself at `parentPath`) has any node one level
 * deeper than it - i.e. whether it has a POPULATED sub-diagram, matching
 * the real app's own existing definition (see findLinkedNodes's
 * `hasSubDiagram` in subDiagramTree.ts: `subDiagram?.nodes.length > 0`,
 * not merely whether a subDiagram object exists at all). There's no
 * separate "opened but empty" state to derive here - nothing in the app
 * ever actually creates one, so this is the only check that's ever
 * needed. */
export function hasSubDiagram(nodes: Node<ArchNodeData>[], parentPath: string[], nodeId: string): boolean {
  return getNodesAtPath(nodes, [...parentPath, nodeId]).length > 0;
}

/** Flattens a recursive SubDiagram tree - root plus every nested
 * sub-diagram, at any depth - into the flat, parentPath-tagged shape
 * this whole module works with. Originally written inline inside
 * createAdapterDiagramStore's own getSnapshot; extracted here once a
 * second caller (seedYjsDiagramDoc, used when starting a collaborative
 * session) needed the exact same logic, so the two don't drift apart by
 * each maintaining their own copy. */
export function flattenSubDiagramTree(root: SubDiagram): { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] } {
  const nodes: Node<ArchNodeData>[] = [];
  const edges: Edge<ArchEdgeData>[] = [];
  function walk(sd: SubDiagram, path: string[]) {
    for (const node of sd.nodes) {
      const { subDiagram, ...restData } = node.data;
      nodes.push({ ...node, data: { ...restData, parentPath: path } as ArchNodeData });
      if (subDiagram) walk(subDiagram, [...path, node.id]);
    }
    for (const edge of sd.edges) {
      edges.push({ ...edge, data: { ...(edge.data as ArchEdgeData), parentPath: path } as ArchEdgeData });
    }
  }
  walk(root, []);
  return { nodes, edges };
}

/** The inverse of flattenSubDiagramTree - rebuilds a recursive
 * SubDiagram tree from a flat, parentPath-tagged node/edge list. Used
 * when leaving a collaborative session: the session's Yjs-backed
 * DiagramStore only ever produces the flat shape, but the app's own
 * local state (root: SubDiagram, read/written via
 * createAdapterDiagramStore) needs the recursive shape back, so
 * whatever happened during the session - the person's own edits, or
 * anything synced in from collaborators - is preserved going forward
 * rather than discarded the moment the connection ends (the same
 * principle already applied to team/requirements/programIncrements'
 * own leaveSession handling).
 *
 * parentPath itself is dropped from each node/edge's data on the way
 * back out - it only ever existed to support the flat representation;
 * position in the rebuilt tree is what encodes nesting once again,
 * exactly as it does everywhere else in the app. */
export function unflattenToSubDiagram(nodes: Node<ArchNodeData>[], edges: Edge<ArchEdgeData>[]): SubDiagram {
  recordUnflattenCall();
  function buildLevel(path: string[]): SubDiagram {
    const levelNodes = getNodesAtPath(nodes, path).map((n) => {
      const restData: Record<string, unknown> = { ...(n.data as Record<string, unknown>) };
      delete restData.parentPath;
      const childSubDiagram = hasSubDiagram(nodes, path, n.id) ? buildLevel([...path, n.id]) : undefined;
      return { ...n, data: { ...restData, subDiagram: childSubDiagram } as ArchNodeData };
    });
    const levelEdges = getEdgesAtPath(edges, path).map((e) => {
      const restData: Record<string, unknown> = { ...(e.data as Record<string, unknown>) };
      delete restData.parentPath;
      return { ...e, data: restData as ArchEdgeData };
    });
    return { nodes: levelNodes, edges: levelEdges };
  }
  return buildLevel([]);
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
      recordStoreWrite();
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
      recordStoreWrite();
      nodes = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
      notify();
    },

    updatePosition: (id, position) => {
      recordStoreWrite();
      nodes = nodes.map((n) => (n.id === id ? { ...n, position } : n));
      notify();
    },

    updateParentId: (id, parentId, position) => {
      recordStoreWrite();
      nodes = nodes.map((n) => (n.id === id ? { ...n, parentId, position } : n));
      notify();
    },

    updateDimensions: (id, width, height) => {
      recordStoreWrite();
      nodes = nodes.map((n) => (n.id === id ? { ...n, width, height } : n));
      notify();
    },

    deleteNode: (id) => {
      recordStoreWrite();
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

    addEdge: (parentPath, source, target, data, sourceHandle, targetHandle) => {
      recordStoreWrite();
      const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const edge: Edge<ArchEdgeData> = {
        id,
        source,
        target,
        sourceHandle,
        targetHandle,
        type: "typed",
        data: { ...data, parentPath } as ArchEdgeData & { parentPath: string[] },
      };
      edges = [...edges, edge];
      notify();
      return id;
    },

    updateEdge: (id, patch) => {
      recordStoreWrite();
      edges = edges.map((e) => (e.id === id ? { ...e, data: { ...(e.data as ArchEdgeData), ...patch } } : e));
      notify();
    },

    deleteEdge: (id) => {
      recordStoreWrite();
      edges = edges.filter((e) => e.id !== id);
      notify();
    },

    reconnectEdge: (id, endpoints) => {
      recordStoreWrite();
      edges = edges.map((e) =>
        e.id === id
          ? {
              ...e,
              source: endpoints.source,
              target: endpoints.target,
              sourceHandle: endpoints.sourceHandle ?? null,
              targetHandle: endpoints.targetHandle ?? null,
            }
          : e
      );
      notify();
    },

    addEdgeWaypoint: (edgeId, index, waypoint) => {
      recordStoreWrite();
      edges = edges.map((e) =>
        e.id === edgeId ? { ...e, data: withWaypointAdded(e.data as ArchEdgeData, index, waypoint) } : e
      );
      notify();
    },

    moveEdgeWaypoint: (edgeId, waypointId, position) => {
      recordStoreWrite();
      edges = edges.map((e) =>
        e.id === edgeId ? { ...e, data: withWaypointMoved(e.data as ArchEdgeData, waypointId, position) } : e
      );
      notify();
    },

    removeEdgeWaypoint: (edgeId, waypointId) => {
      recordStoreWrite();
      edges = edges.map((e) =>
        e.id === edgeId ? { ...e, data: withWaypointRemoved(e.data as ArchEdgeData, waypointId) } : e
      );
      notify();
    },

    clearEdgeWaypoints: (edgeId) => {
      recordStoreWrite();
      edges = edges.map((e) =>
        e.id === edgeId ? { ...e, data: withWaypointsCleared(e.data as ArchEdgeData) } : e
      );
      notify();
    },
  };
}
