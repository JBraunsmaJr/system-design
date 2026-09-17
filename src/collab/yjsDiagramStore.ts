import * as Y from "yjs";
import { orderIdSet, pushIfAbsent } from "./seedGuards.ts";
import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, EdgeWaypoint, SubDiagram } from "../domain/types";
import type { DiagramStore } from "./diagramStore";
import { flattenSubDiagramTree } from "./diagramStore";
import { recordSnapshotBuild, recordStoreWrite } from "../perf/instrumentation";

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
  "zIndex",
] as const;

/**
 * Deliberately does NOT include `waypoints`. Every field listed here is
 * stored as a plain value and replaced wholesale on each edit, which is
 * exactly the wrong thing for a list several people can be editing
 * different parts of at once - see WAYPOINTS_KEY below.
 */
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
 * An edge's bends live under this key as a `Y.Array<Y.Map>` - a real
 * nested shared type, not a plain array value.
 *
 * This is the one place in the diagram schema where that distinction
 * earns its keep, so it's worth being explicit about what each layer
 * buys:
 *
 *  - Y.ARRAY rather than a plain array, because insertion position is
 *    meaningful. Two people adding a bend to the same edge at the same
 *    time is an ordinary thing to do; with a plain array, whoever's
 *    write lands second replaces the whole list and the other bend
 *    simply vanishes. Y.Array merges both inserts and keeps them in a
 *    consistent order on every peer.
 *
 *  - Y.MAP per waypoint rather than a plain {x, y} object, because a
 *    drag is a continuous stream of writes to ONE bend. Nested maps mean
 *    those writes touch only that bend's own x/y - so two people
 *    dragging two different bends on the same edge simultaneously both
 *    keep their changes, instead of each frame of one drag reverting the
 *    other. Two people dragging the SAME bend still resolves
 *    last-writer-wins, which is the only sensible answer and matches
 *    what already happens for node position.
 *
 *  - A stable `id` INSIDE each map, because it gives each bend an
 *    identity that survives its neighbours being inserted or removed.
 *    That's what lets moveEdgeWaypoint/removeEdgeWaypoint address a bend
 *    without using an index that a concurrent edit may already have
 *    shifted out from under them.
 *
 * This follows the same rule the rest of this file already applies -
 * nest when field-level patch operations exist, stay a plain value when
 * the whole thing is replaced at once (properties, parentPath). Bends
 * have four dedicated patch operations, so they nest.
 */
const WAYPOINTS_KEY = "waypoints";

function makeWaypointMap(waypoint: EdgeWaypoint): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set("id", waypoint.id);
  m.set("x", waypoint.x);
  m.set("y", waypoint.y);
  return m;
}

function readWaypointArray(edgeMap: Y.Map<unknown>): Y.Array<Y.Map<unknown>> | undefined {
  const value = edgeMap.get(WAYPOINTS_KEY);
  return value instanceof Y.Array ? (value as Y.Array<Y.Map<unknown>>) : undefined;
}

/** Must be called inside a transaction: the array is set on the edge map
 * and then read back, so that what's returned is the INTEGRATED shared
 * type rather than the detached one that was just handed over.
 *
 * This is a FALLBACK, not the normal path. Creating the container lazily
 * is itself a last-writer-wins write to the edge map's `waypoints` key,
 * so two peers adding the very first bend to the same edge at the same
 * moment would each create their own array, and whichever lost the key
 * would take its owner's bend down with it - the exact failure the
 * nested schema exists to prevent, reintroduced one level up. Every edge
 * this code creates therefore gets its (empty) array up front at
 * creation and seeding time instead, so there is nothing left to race
 * over. What remains here covers an edge that somehow arrived without
 * one. */
function ensureWaypointArray(edgeMap: Y.Map<unknown>): Y.Array<Y.Map<unknown>> {
  const existing = readWaypointArray(edgeMap);
  if (existing) return existing;
  edgeMap.set(WAYPOINTS_KEY, new Y.Array<Y.Map<unknown>>());
  return readWaypointArray(edgeMap)!;
}

/** The current index of the bend with this id, or -1. Re-resolved on
 * every single operation rather than cached anywhere, which is the whole
 * point: an index is only valid for as long as nobody else has inserted
 * or removed a bend earlier in the same edge. */
function waypointIndexById(array: Y.Array<Y.Map<unknown>>, waypointId: string): number {
  const items = array.toArray();
  for (let i = 0; i < items.length; i++) {
    if (items[i]?.get("id") === waypointId) return i;
  }
  return -1;
}

/**
 * Populates a Y.Doc directly from an existing, already-populated
 * recursive SubDiagram tree (the app's own local representation - see
 * diagramStore.ts's own doc comment on why the actual app doesn't use
 * this flat schema natively) - the diagram-domain equivalent of
 * seedYjsRequirementsDoc/seedYjsProgramIncrementsDoc, needed for the
 * same reason: starting a collaborative session must carry over
 * whatever's already there, not start from an empty canvas.
 *
 * Uses flattenSubDiagramTree (diagramStore.ts) to do the tree-to-flat
 * conversion - the exact same logic createAdapterDiagramStore's own
 * getSnapshot uses, so there's one, single source of truth for how that
 * conversion works rather than a second copy that could drift out of
 * sync. Every node's own id, and every group-containment parentId, is
 * preserved exactly as it already is - node/edge ids are purely
 * internal (see this file's own collisionResistantId comment above),
 * but preserving them here still matters: edges reference nodes by id,
 * and group-contained children reference their group by id, so
 * regenerating any of them during seeding would need a full remapping
 * pass to avoid silently breaking those references, which preserving
 * the originals avoids needing at all.
 */
/**
 * Writes only the fields that have a value. Every Y.Map entry is stored with
 * its key, for every node, forever - and most data fields are unset on most
 * nodes. Writing them as `undefined` cost 11 stored entries per node: a
 * freshly seeded 50-node diagram was 19KB, which was also the floor any
 * rebase could reach (WS4-R6). Readers already treat a missing key and an
 * undefined one alike.
 */
/**
 * The level a new entry lives at. The root level - where most entries are -
 * is stored as no key at all, and read back as `[]`: an empty array stored on
 * every root node was the largest remaining per-node cost. Every reader
 * already treats a missing level as the root.
 */
function setLevel(m: Y.Map<unknown>, parentPath: string[] | undefined): void {
  if (parentPath && parentPath.length > 0) m.set("parentPath", parentPath);
}

function setDefinedFields(m: Y.Map<unknown>, fields: readonly string[], source: Record<string, unknown>): void {
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) m.set(field, value);
  }
}

export function seedYjsDiagramDoc(doc: Y.Doc, root: SubDiagram): void {
  const { nodes, edges } = flattenSubDiagramTree(root);
  const nodeOrder = doc.getArray<string>("nodeOrder");
  const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
  const edgeOrder = doc.getArray<string>("edgeOrder");
  const edgesMap = doc.getMap<Y.Map<unknown>>("edges");
  // Seeding must be safe to attempt against a document that persistence has
  // already restored - see seedGuards.ts.
  const seenNodes = orderIdSet(nodeOrder);
  const seenEdges = orderIdSet(edgeOrder);

  doc.transact(() => {
    for (const node of nodes) {
      if (seenNodes.has(node.id) || nodesMap.has(node.id)) continue;
      const m = new Y.Map<unknown>();
      m.set("type", node.type);
      m.set("position", node.position);
      setLevel(m, (node.data as ArchNodeData & { parentPath?: string[] }).parentPath);
      if (node.parentId !== undefined) m.set("parentId", node.parentId);
      if (node.width !== undefined) m.set("width", node.width);
      if (node.height !== undefined) m.set("height", node.height);
      setDefinedFields(m, NODE_DATA_FIELDS, node.data as Record<string, unknown>);
      nodesMap.set(node.id, m);
      pushIfAbsent(nodeOrder, seenNodes, node.id);
    }
    for (const edge of edges) {
      if (seenEdges.has(edge.id) || edgesMap.has(edge.id)) continue;
      const m = new Y.Map<unknown>();
      m.set("source", edge.source);
      m.set("target", edge.target);
      m.set("type", edge.type ?? "typed");
      setLevel(m, (edge.data as ArchEdgeData & { parentPath?: string[] }).parentPath);
      if (edge.sourceHandle !== undefined) m.set("sourceHandle", edge.sourceHandle);
      if (edge.targetHandle !== undefined) m.set("targetHandle", edge.targetHandle);
      setDefinedFields(m, EDGE_DATA_FIELDS, (edge.data ?? {}) as Record<string, unknown>);
      // Bends carried in from local state have to be rebuilt as real
      // nested shared types, not set as the plain array they arrive as -
      // otherwise an edge that was bent before the session started would
      // be the one edge in the document that doesn't merge properly.
      // The array is created for EVERY edge, empty or not, so that no
      // two peers ever race to create it later (see ensureWaypointArray).
      const array = new Y.Array<Y.Map<unknown>>();
      const waypoints = (edge.data as ArchEdgeData | undefined)?.waypoints;
      if (waypoints && waypoints.length > 0) array.push(waypoints.map(makeWaypointMap));
      m.set(WAYPOINTS_KEY, array);
      edgesMap.set(edge.id, m);
      pushIfAbsent(edgeOrder, seenEdges, edge.id);
    }
  });
}


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
    // Absent means the root level - see setLevel.
    const data: Record<string, unknown> = { parentPath: (m.get("parentPath") as string[] | undefined) ?? [] };
    for (const field of NODE_DATA_FIELDS) {
      const value = m.get(field);
      if (value !== undefined) data[field] = value;
    }
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
    // Absent means the root level - see setLevel.
    const data: Record<string, unknown> = { parentPath: (m.get("parentPath") as string[] | undefined) ?? [] };
    for (const field of EDGE_DATA_FIELDS) {
      const value = m.get(field);
      if (value !== undefined) data[field] = value;
    }
    // Only surfaced when there's actually something in it. An edge whose
    // bends were all cleared keeps an empty Y.Array (see
    // clearEdgeWaypoints on why it isn't deleted outright), and that has
    // to be indistinguishable from an edge that was never bent - both in
    // what gets saved to a file and in diagramStore.verify.ts's check
    // that the local and Yjs stores emit the same set of data keys.
    const waypointArray = readWaypointArray(m);
    if (waypointArray && waypointArray.length > 0) {
      data.waypoints = waypointArray.toArray().map(
        (w): EdgeWaypoint => ({
          id: w.get("id") as string,
          x: w.get("x") as number,
          y: w.get("y") as number,
        })
      );
    }
    const edge: Edge<ArchEdgeData> = {
      id,
      source: m.get("source") as string,
      target: m.get("target") as string,
      type: m.get("type") as string,
      data: data as ArchEdgeData,
    };
    const sourceHandle = m.get("sourceHandle") as string | null | undefined;
    if (sourceHandle !== undefined) edge.sourceHandle = sourceHandle;
    const targetHandle = m.get("targetHandle") as string | null | undefined;
    if (targetHandle !== undefined) edge.targetHandle = targetHandle;
    return edge;
  }

  /**
   * Plain objects from the last snapshot, reused for every node and edge whose
   * shared type did not change (WS1-R8, migration plan hazard 2.4).
   *
   * Rebuilding every object on every change made each write - one frame of a
   * drag, one remote update - hand React Flow a brand new object for every
   * node and edge. React Flow keeps its internal node only when the object is
   * IDENTICAL to last time, so all of them re-rendered: a 20-step drag of one
   * node rendered 16,000 nodes. Only the entries a transaction touched are
   * rebuilt now; everything else keeps its identity.
   */
  const nodeCache = new Map<string, { source: Y.Map<unknown>; plain: Node<ArchNodeData> }>();
  const edgeCache = new Map<string, { source: Y.Map<unknown>; plain: Edge<ArchEdgeData> }>();
  const dirtyNodes = new Set<string>();
  const dirtyEdges = new Set<string>();

  function reuse<T>(
    cache: Map<string, { source: Y.Map<unknown>; plain: T }>,
    dirty: Set<string>,
    id: string,
    source: Y.Map<unknown>,
    build: (id: string, m: Y.Map<unknown>) => T
  ): T {
    const hit = cache.get(id);
    if (hit && hit.source === source && !dirty.has(id)) return hit.plain;
    const plain = build(id, source);
    cache.set(id, { source, plain });
    return plain;
  }

  function buildSnapshot(): { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] } {
    recordSnapshotBuild();
    const nodeIds = nodeOrder.toArray();
    const edgeIds = edgeOrder.toArray();
    const nodes: Node<ArchNodeData>[] = [];
    for (const id of nodeIds) {
      const m = nodesMap.get(id);
      if (m) nodes.push(reuse(nodeCache, dirtyNodes, id, m, nodeMapToPlain));
    }
    const edges: Edge<ArchEdgeData>[] = [];
    for (const id of edgeIds) {
      const m = edgesMap.get(id);
      if (m) edges.push(reuse(edgeCache, dirtyEdges, id, m, edgeMapToPlain));
    }
    // Forget entries that are no longer in the document, so the caches cannot
    // grow without bound across deletes.
    if (nodeCache.size > nodes.length) {
      const live = new Set(nodeIds);
      for (const id of nodeCache.keys()) if (!live.has(id)) nodeCache.delete(id);
    }
    if (edgeCache.size > edges.length) {
      const live = new Set(edgeIds);
      for (const id of edgeCache.keys()) if (!live.has(id)) edgeCache.delete(id);
    }
    dirtyNodes.clear();
    dirtyEdges.clear();
    return { nodes, edges };
  }

  let cached = buildSnapshot();
  let changed = false;
  const listeners = new Set<() => void>();

  /**
   * Records which entries a transaction touched. `event.path` is relative to
   * the observed root, so for anything nested inside an entry (a node's
   * fields, an edge's waypoint array) its first segment is the entry's id.
   * A change to the root map itself names the ids in `changes.keys`. Order
   * arrays touch no entry's content, only the sequence.
   */
  const trackChanges = (dirty: Set<string>) => (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    for (const event of events) {
      const [first] = event.path;
      if (typeof first === "string") {
        dirty.add(first);
      } else if (event.path.length === 0 && event.target instanceof Y.Map) {
        for (const key of event.changes.keys.keys()) dirty.add(key);
      }
    }
    changed = true;
  };
  const onNodesChange = trackChanges(dirtyNodes);
  const onEdgesChange = trackChanges(dirtyEdges);
  const onOrderChange = () => {
    changed = true;
  };

  /**
   * One rebuild and one notification per transaction, however many of the
   * four observed types it touched. afterTransaction fires once observers have
   * run, so every change is already recorded.
   */
  const flush = () => {
    if (!changed) return;
    changed = false;
    cached = buildSnapshot();
    for (const listener of listeners) listener();
  };

  nodesMap.observeDeep(onNodesChange);
  edgesMap.observeDeep(onEdgesChange);
  nodeOrder.observe(onOrderChange);
  edgeOrder.observe(onOrderChange);
  doc.on("afterTransaction", flush);
  let destroyed = false;

  function isPathAtOrBelow(path: string[], ancestorPrefix: string[]): boolean {
    if (path.length < ancestorPrefix.length) return false;
    return ancestorPrefix.every((v, i) => path[i] === v);
  }

  return {
    getSnapshot: () => cached,

    /** Detaches the observers registered above. Idempotent: a second call is a
     * no-op rather than an error, so teardown paths can be defensive. */
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      nodesMap.unobserveDeep(onNodesChange);
      edgesMap.unobserveDeep(onEdgesChange);
      nodeOrder.unobserve(onOrderChange);
      edgeOrder.unobserve(onOrderChange);
      doc.off("afterTransaction", flush);
    },
    replaceAll: (next) => {
      recordStoreWrite();
      // One transaction so observers see a single change rather than an empty
      // diagram followed by a populated one - the intermediate state would
      // render as a blank canvas for a frame.
      doc.transact(() => {
        nodeOrder.delete(0, nodeOrder.length);
        nodesMap.clear();
        edgeOrder.delete(0, edgeOrder.length);
        edgesMap.clear();
        seedYjsDiagramDoc(doc, next);
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addNode: (parentPath, type, position, data) => {
      recordStoreWrite();
      const id = collisionResistantId("node");
      doc.transact(() => {
        const m = new Y.Map<unknown>();
        m.set("type", type);
        m.set("position", position);
        setLevel(m, parentPath);
        setDefinedFields(m, NODE_DATA_FIELDS, data as Record<string, unknown>);
        nodesMap.set(id, m);
        nodeOrder.push([id]);
      });
      return id;
    },

    updateNode: (id, patch) => {
      recordStoreWrite();
      const m = nodesMap.get(id);
      if (!m) return;
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          m.set(key, value);
        }
      });
    },

    updatePosition: (id, position) => {
      recordStoreWrite();
      const m = nodesMap.get(id);
      if (m) m.set("position", position);
    },

    updateParentId: (id, parentId, position) => {
      recordStoreWrite();
      const m = nodesMap.get(id);
      if (!m) return;
      doc.transact(() => {
        m.set("parentId", parentId);
        m.set("position", position);
      });
    },

    updateDimensions: (id, width, height) => {
      recordStoreWrite();
      const m = nodesMap.get(id);
      if (!m) return;
      doc.transact(() => {
        m.set("width", width);
        m.set("height", height);
      });
    },

    deleteNode: (id) => {
      recordStoreWrite();
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

    addEdge: (parentPath, source, target, data, sourceHandle, targetHandle) => {
      recordStoreWrite();
      const id = collisionResistantId("edge");
      doc.transact(() => {
        const m = new Y.Map<unknown>();
        m.set("source", source);
        m.set("target", target);
        m.set("type", "typed");
        setLevel(m, parentPath);
        if (sourceHandle !== undefined) m.set("sourceHandle", sourceHandle);
        if (targetHandle !== undefined) m.set("targetHandle", targetHandle);
        setDefinedFields(m, EDGE_DATA_FIELDS, data as Record<string, unknown>);
        // Empty, but present from the start - so that two peers bending
        // this edge for the first time at the same moment insert into
        // one shared array rather than each creating their own and one
        // of them losing the key (see ensureWaypointArray). An empty
        // array reads back as no waypoints at all, so nothing
        // downstream can tell it's there.
        m.set(WAYPOINTS_KEY, new Y.Array<Y.Map<unknown>>());
        edgesMap.set(id, m);
        edgeOrder.push([id]);
      });
      return id;
    },

    updateEdge: (id, patch) => {
      recordStoreWrite();
      const m = edgesMap.get(id);
      if (!m) return;
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          if (key === WAYPOINTS_KEY) continue;
          m.set(key, value);
        }
      });
    },

    deleteEdge: (id) => {
      recordStoreWrite();
      doc.transact(() => {
        edgesMap.delete(id);
        const idx = edgeOrder.toArray().indexOf(id);
        if (idx !== -1) edgeOrder.delete(idx, 1);
      });
    },

    reconnectEdge: (id, endpoints) => {
      recordStoreWrite();
      const m = edgesMap.get(id);
      if (!m) return;
      // One transaction, so no peer can ever observe the new target
      // paired with the old source. Concurrent reconnections of the SAME
      // edge by two people resolve last-writer-wins, same as any other
      // field - and because all four keys are written together by both
      // peers, Yjs's per-key resolution lands them on the same winner
      // rather than splicing one person's source onto the other's
      // target.
      doc.transact(() => {
        m.set("source", endpoints.source);
        m.set("target", endpoints.target);
        m.set("sourceHandle", endpoints.sourceHandle ?? null);
        m.set("targetHandle", endpoints.targetHandle ?? null);
      });
    },

    addEdgeWaypoint: (edgeId, index, waypoint) => {
      recordStoreWrite();
      const m = edgesMap.get(edgeId);
      if (!m) return;
      doc.transact(() => {
        const array = ensureWaypointArray(m);
        const clamped = Math.max(0, Math.min(index, array.length));
        array.insert(clamped, [makeWaypointMap(waypoint)]);
      });
    },

    moveEdgeWaypoint: (edgeId, waypointId, position) => {
      recordStoreWrite();
      const m = edgesMap.get(edgeId);
      if (!m) return;
      const array = readWaypointArray(m);
      if (!array) return;
      const index = waypointIndexById(array, waypointId);
      if (index === -1) return; // removed by a peer mid-drag; nothing to move
      const waypointMap = array.get(index);
      if (!waypointMap) return;
      // Writes land on the waypoint's OWN map. Nothing here touches the
      // array, so a peer inserting or removing a different bend during
      // this drag neither conflicts with it nor gets overwritten by it.
      doc.transact(() => {
        waypointMap.set("x", position.x);
        waypointMap.set("y", position.y);
      });
    },

    removeEdgeWaypoint: (edgeId, waypointId) => {
      recordStoreWrite();
      const m = edgesMap.get(edgeId);
      if (!m) return;
      const array = readWaypointArray(m);
      if (!array) return;
      const index = waypointIndexById(array, waypointId);
      if (index === -1) return; // already removed by a peer
      doc.transact(() => array.delete(index, 1));
    },

    clearEdgeWaypoints: (edgeId) => {
      recordStoreWrite();
      const m = edgesMap.get(edgeId);
      if (!m) return;
      const array = readWaypointArray(m);
      if (!array || array.length === 0) return;
      // Empties the array rather than deleting the key. If the key went
      // away, a peer who was mid-drag would be holding a reference to an
      // array that's no longer attached to anything, and their remaining
      // writes would land somewhere nobody can see. Emptying leaves the
      // container in place, so a concurrent "add a bend" still arrives
      // somewhere real. An empty array reads back as no waypoints at all
      // (see edgeMapToPlain), so nothing downstream can tell.
      doc.transact(() => array.delete(0, array.length));
    },
  };
}
