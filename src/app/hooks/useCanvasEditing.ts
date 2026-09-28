import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Node, Edge, Connection, OnNodesChange, OnEdgesChange } from '@xyflow/react';
import {
  getNodesAtPath,
  populatedLevelCounts,
  type DiagramStore,
} from '../../collab/stores/diagramStore';
import type { UndoController } from '../../collab/stores/undoManager';
import type { PresenceInfo } from '../../collab/sync/session';
import { NODE_TYPES } from '../../domain/canvas/nodeRegistry';
import { GROUP_TYPES } from '../../domain/canvas/groupRegistry';
import { SHAPE_TYPES, globalShapeRegistry } from '../../domain/canvas/shapeRegistry';
import {
  isDescendantOf,
  selectNodesToAdopt,
  toAbsolutePosition,
  toRelativePosition,
} from '../../domain/canvas/graphUtils';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { EdgeEndpoints } from '../../domain/canvas/edgeReconnect';
import { applyZOrderCommand, type ZOrderCommand } from '../../domain/canvas/zOrder';
import {
  mergeInFlight,
  remoteInFlight,
  toBroadcast,
  NO_IN_FLIGHT,
  type InFlightMap,
  applyEdgeGesture,
  edgeGestureWrites,
  remoteEdgeGestures,
  remoteEdgeLabels,
  changesWaypoints,
  type LabelPlacement,
  NO_EDGE_GESTURES,
  type EdgeGesture,
  type EdgeGestureMap,
} from '../../domain/canvas/gestureGeometry';
import {
  classifyNodeChanges,
  applySelectionChanges,
  isAutoSizedNodeType,
  type PendingNodeUpdate,
  type CurrentNodeGeometry,
} from '../../domain/canvas/nodeChangeBatching';
import type {
  ArchNodeData,
  ArchEdgeData,
  ArchEdgeDataPatch,
  EdgeWaypoint,
} from '../../domain/canvas/types';
import { projectCanvasElements } from '../canvasProjection';

export interface UseCanvasEditingOptions {
  diagramStore: DiagramStore;
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  undo: UndoController;
  activeSession: object | null;
  presencePeers: PresenceInfo[];
  /** Must be stable - App's is a useCallback with no deps. */
  broadcastPresence: (patch: Partial<PresenceInfo>) => void;
  path: DiagramPath;
  setPath: Dispatch<SetStateAction<DiagramPath>>;
  selectedNodeIds: string[];
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  selectedEdgeIds: string[];
  setSelectedEdgeIds: Dispatch<SetStateAction<string[]>>;
  isPresenting: boolean;
  setActiveStepId: Dispatch<SetStateAction<string | null>>;
}

/**
 * Everything the canvas renders and every edit it can make: the projected
 * nodes and edges, gesture batching (WS4), adding, reparenting, reordering,
 * deleting, edge bends, and drilling between levels.
 *
 * Moved unchanged from App.tsx. The only edits are the state setters
 * received as parameters, now listed in the dependency arrays that use them
 * (React setters, so this changes no callback's identity), and the
 * projection memo, whose body moved to canvasProjection.ts.
 *
 * PERFORMANCE: every callback here reaches the canvas, and several go on to
 * every node and edge through CanvasContext or React Flow's memoised
 * wrappers. A callback that changes identity on each render re-renders all
 * of them - on the techdebt/deconstruction branch a single-node drag went
 * from 23 node renders to 8,421 that way. Before adding a dependency to any
 * callback here, check whether it changes during a drag; if it does, read it
 * through a ref at call time instead, as onAdoptIntoGroup and onUpdateNode
 * do.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoised with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useCanvasEditing({
  diagramStore,
  diagramSnapshot,
  undo,
  activeSession,
  presencePeers,
  broadcastPresence,
  path,
  setPath,
  selectedNodeIds,
  setSelectedNodeIds,
  selectedEdgeIds,
  setSelectedEdgeIds,
  isPresenting,
  setActiveStepId,
}: UseCanvasEditingOptions) {
  const diagramStoreRef = useRef(diagramStore);
  // Layout effect rather than a render-phase assignment, for the same
  // reason as activeSessionRef above - and with the same consequence if
  // it's wrong, since this ref decides whether an edit lands in the
  // local adapter store or the session's shared Yjs doc. Its only
  // readers are the onUpdateNode/onUpdateEdge callbacks further down,
  // both invoked from event handlers.
  useLayoutEffect(() => {
    diagramStoreRef.current = diagramStore;
  }, [diagramStore]);

  // This client's own record of what React Flow last measured each node
  // to be. Deliberately state rather than a ref, even though it's only
  // ever written from an event handler: the nodes memo below reads it
  // during render, which is exactly what a ref must not be used for.
  // Writes are guarded on the value actually having changed, so the
  // steady state (React Flow re-reporting sizes that didn't change) sets
  // no state and triggers no render. Purely local and never written to
  // any store - see the `measured` line below, and isAutoSizedNodeType,
  // for why sharing it is what broke.
  const [measuredDimensions, setMeasuredDimensions] = useState<
    Map<string, { width: number; height: number }>
  >(() => new Map());

  // nodes/edges are derived from diagramStore rather than stored directly -
  // selection is deliberately NOT part of that store's schema (it's
  // ephemeral, per-person state, not something a collaborator should see
  // reflected in their own view), so it's combined in here on every read
  // instead, using selectedNodeIds/selectedEdgeIds as the sole source of
  // truth. This replaces what used to be tracked as a `.selected` field
  // persisted directly on the node/edge objects themselves.
  /**
   * Geometry of nodes this user is dragging or resizing right now (WS4-R1).
   * Rendered over the document and broadcast to peers, but not written to the
   * document until the gesture ends - see flushPendingNodeUpdates.
   */
  const [inFlight, setInFlight] = useState<InFlightMap>(NO_IN_FLIGHT);
  const inFlightRef = useRef<InFlightMap>(NO_IN_FLIGHT);
  /** Edge bends being dragged by this user, rendered but not yet written. */
  const [edgeInFlight, setEdgeInFlight] = useState<EdgeGestureMap>(NO_EDGE_GESTURES);
  const edgeGesturesRef = useRef(new Map<string, EdgeGesture>());
  /** Other peers' in-flight bends and labels at this level. */
  const peerEdgeInFlight = useMemo(
    () => (activeSession ? remoteEdgeGestures(presencePeers, path.join('/')) : new Map()),
    [activeSession, presencePeers, path],
  );
  const peerEdgeLabels = useMemo(
    () =>
      activeSession
        ? remoteEdgeLabels(presencePeers, path.join('/'))
        : new Map<string, LabelPlacement>(),
    [activeSession, presencePeers, path],
  );
  /** Other peers' in-flight geometry at this level (WS4-R3). */
  const peerInFlight = useMemo(
    () => (activeSession ? remoteInFlight(presencePeers, path.join('/')) : NO_IN_FLIGHT),
    [activeSession, presencePeers, path],
  );

  const subDiagramLevelCounts = useMemo(
    () => populatedLevelCounts(diagramSnapshot.nodes),
    [diagramSnapshot],
  );
  // PERFORMANCE: the body is projectCanvasElements (canvasProjection.ts),
  // moved there unchanged so it can be tested. The dependency list is the
  // one this memo always had; the input object is built only when it runs.
  const { nodes, edges } = useMemo(
    () =>
      projectCanvasElements({
        diagramSnapshot,
        subDiagramLevelCounts,
        path,
        selectedNodeIds,
        selectedEdgeIds,
        measuredDimensions,
        inFlight,
        peerInFlight,
        edgeInFlight,
        peerEdgeInFlight,
        peerEdgeLabels,
      }),
    [
      diagramSnapshot,
      subDiagramLevelCounts,
      path,
      selectedNodeIds,
      selectedEdgeIds,
      measuredDimensions,
      inFlight,
      peerInFlight,
      edgeInFlight,
      peerEdgeInFlight,
      peerEdgeLabels,
    ],
  );

  // Only position/dimensions changes need to reach the store - selection
  // changes are handled separately (and more robustly, since it's the
  // full aggregate rather than an incremental diff) via onSelectionChange
  // below. 'remove' changes are never expected here: Canvas.tsx sets
  // deleteKeyCode={null}, so React Flow's own delete-key handling never
  // fires through this path at all - deletion always goes through the
  // app's own onDeleteNode/onDeleteEdge, which have additional logic
  // (group-child release, populated-sub-diagram confirmation) a raw
  // 'remove' change would bypass entirely. 'add'/'replace' aren't
  // expected either: nodes are always added via explicit app actions.
  // Position/dimension changes are coalesced to at most one store commit
  // per animation frame while a gesture is actively in progress, rather
  // than one commit per raw browser event - mousemove can fire far
  // faster than the screen refreshes (especially on high-polling-rate
  // mice), and every commit was triggering a full diagramStore rebuild
  // plus a full app re-render, which is what made dragging both slow
  // and visually unreliable. pendingNodeUpdates is keyed by node id, so
  // multiple updates to the SAME node within one frame simply overwrite
  // each other (only the latest position/size within the frame ever
  // gets committed) - correctly handles dragging several selected nodes
  // together too, since each gets its own independent pending entry.
  const nodesRef = useRef(nodes);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const pendingNodeUpdates = useRef(new Map<string, PendingNodeUpdate>());
  /** Reparents requested while a gesture's commit is pending (a node dropped
   * into a group), applied last inside that commit - see onReparentNode. */
  const pendingReparents = useRef(new Map<string, string | undefined>());
  const commitScheduled = useRef(false);
  const pendingFlushHandle = useRef<number | null>(null);

  /**
   * Folds this frame's pending geometry into the in-flight overlay and
   * broadcasts it - nothing reaches the document mid-gesture (WS4-R1).
   */
  const flushPendingNodeUpdates = useCallback(() => {
    pendingFlushHandle.current = null;
    const pending = pendingNodeUpdates.current;
    if (pending.size === 0) return;
    const next = mergeInFlight(inFlightRef.current, pending);
    pending.clear();
    inFlightRef.current = next;
    setInFlight(next);
    broadcastPresence({ gesture: toBroadcast(path.join('/'), next) });
  }, [broadcastPresence, path]);

  /**
   * Ends a gesture: every node it moved or resized is written exactly once
   * (WS4-R2), in ONE transaction under the undo origin, so peers receive one
   * update and the whole gesture is one undo step. Also the path for
   * standalone changes (an arrow-key nudge, a snap correction), which have no
   * overlay and simply commit.
   */
  const commitNodeGesture = useCallback(() => {
    commitScheduled.current = false;
    const pending = pendingNodeUpdates.current;
    const final = mergeInFlight(inFlightRef.current, pending);
    pending.clear();
    const reparents = new Map(pendingReparents.current);
    pendingReparents.current.clear();
    if (final.size > 0 || reparents.size > 0) {
      undo.transact(() => {
        for (const [id, g] of final) {
          // A reparented node's position is written by updateParentId below,
          // relative to its new parent - writing it here as well would be a
          // second write for the same node.
          if (g.position && !reparents.has(id)) diagramStore.updatePosition(id, g.position);
          if (g.width !== undefined || g.height !== undefined)
            diagramStore.updateDimensions(id, g.width, g.height);
        }
        // Relative positions are derived here, from the geometry this commit
        // is writing - the last rendered frame can be a frame or two behind
        // the release, which put the node visibly off from where it was
        // dropped.
        const rendered = nodesRef.current;
        const withFinal = (n: Node<ArchNodeData>) => {
          const g = final.get(n.id);
          return g?.position ? { ...n, position: g.position } : n;
        };
        const current = rendered.map(withFinal);
        for (const [id, parentId] of reparents) {
          const node = current.find((n) => n.id === id);
          if (!node) continue;
          if (parentId && (parentId === id || isDescendantOf(parentId, id, current))) continue;
          const absolute = toAbsolutePosition(node, current, node.parentId);
          const position = toRelativePosition(absolute, current, parentId);
          diagramStore.updateParentId(id, parentId, position);
        }
      });
    }
    // Cleared in the same batch as the store notification above, so no frame
    // shows the node back at its old position.
    if (inFlightRef.current.size > 0) {
      inFlightRef.current = NO_IN_FLIGHT;
      setInFlight(NO_IN_FLIGHT);
      broadcastPresence({ gesture: null });
    }
  }, [undo, diagramStore, broadcastPresence]);

  // Cancels any still-pending animation frame if the component unmounts
  // mid-gesture, so a stale callback can never fire against a store that
  // may no longer even be the active one (e.g. a session having just
  // ended).
  useEffect(() => {
    return () => {
      if (pendingFlushHandle.current !== null) cancelAnimationFrame(pendingFlushHandle.current);
    };
  }, []);

  const onNodesChange = useCallback<OnNodesChange<Node<ArchNodeData>>>(
    (changes) => {
      // Handled here, synchronously, rather than relying solely on
      // onSelectionChange below: React Flow's own source
      // (SelectionListenerInner) calls onSelectionChange from INSIDE a
      // useEffect, one render cycle after the actual click - which
      // doesn't match this app's own controlled-nodes-array setup (see
      // this file's own notes on why React Flow needs the app to feed
      // position/dimension changes back promptly for the same reason).
      // That one-render delay was reported as a real, concrete bug:
      // selecting node A appeared to do nothing, and only selecting
      // node B afterward caused A (not B) to visibly become selected -
      // exactly the symptom of a selection update that's always one
      // interaction behind. Each 'select' change is independent and
      // incremental (a normal click replacing the whole selection still
      // arrives as multiple changes in the same batch - deselect the
      // old, select the new - not a single "replace everything" event),
      // so folding them in here one at a time is correct.
      setSelectedNodeIds((cur) => applySelectionChanges(changes, cur));

      // Recorded for EVERY node, including the content-sized ones whose
      // dimensions deliberately never reach the store - this is exactly
      // the value the nodes memo re-attaches so a remote edit doesn't
      // wipe it, so it has to be kept current regardless of whether the
      // change is also going to be committed. The same-value check
      // matters: React Flow re-reports unchanged sizes routinely, and
      // returning the existing Map for those keeps this from rendering
      // on every one of them.
      setMeasuredDimensions((cur) => {
        let next: Map<string, { width: number; height: number }> | null = null;
        for (const change of changes) {
          if (change.type !== 'dimensions' || !change.dimensions) continue;
          const prev = cur.get(change.id);
          if (
            prev &&
            prev.width === change.dimensions.width &&
            prev.height === change.dimensions.height
          )
            continue;
          next ??= new Map(cur);
          next.set(change.id, { width: change.dimensions.width, height: change.dimensions.height });
        }
        return next ?? cur;
      });

      const currentNodeGeometry = new Map<string, CurrentNodeGeometry>(
        nodesRef.current.map((n) => [
          n.id,
          {
            position: n.position,
            width: n.width,
            height: n.height,
            isAutoSized: isAutoSizedNodeType(n.type),
          },
        ]),
      );
      const { isActiveGesture, gestureEnded } = classifyNodeChanges(
        changes,
        pendingNodeUpdates.current,
        currentNodeGeometry,
      );
      const gestureInProgress = inFlightRef.current.size > 0;
      if (isActiveGesture) {
        if (pendingFlushHandle.current === null) {
          pendingFlushHandle.current = requestAnimationFrame(flushPendingNodeUpdates);
        }
      } else if (gestureEnded) {
        // Released. Committed in a microtask rather than here, because React
        // Flow calls onNodeDragStop right after this - and its alignment-snap
        // correction and drop-into-group reparent belong to the same gesture.
        // Folding them in keeps it to one write per node (WS4-R2) and one
        // transaction. A microtask still runs before the next paint.
        if (pendingFlushHandle.current !== null) {
          cancelAnimationFrame(pendingFlushHandle.current);
          pendingFlushHandle.current = null;
        }
        if (!commitScheduled.current) {
          commitScheduled.current = true;
          queueMicrotask(commitNodeGesture);
        }
      } else if (
        !gestureInProgress &&
        !commitScheduled.current &&
        pendingNodeUpdates.current.size > 0
      ) {
        // A standalone change with no gesture open (an arrow-key nudge).
        // Anything arriving while a gesture is open or awaiting its commit -
        // a snap correction, a stray batch mid-drag - stays pending and is
        // folded into that commit instead of committing on its own.
        commitNodeGesture();
      }
    },
    [flushPendingNodeUpdates, commitNodeGesture, setSelectedNodeIds],
  );

  // Edges have no position/dimensions concept, so the only thing this
  // needs to do is the same synchronous 'select' handling as
  // onNodesChange above, for the identical reason (onSelectionChange's
  // own one-render-cycle delay via React Flow's internal useEffect).
  // 'remove'/'add'/'replace' are never expected here - see this file's
  // other notes on why edges are always added/removed via explicit app
  // actions, never through this path.
  const onEdgesChange = useCallback<OnEdgesChange<Edge<ArchEdgeData>>>(
    (changes) => {
      setSelectedEdgeIds((cur) => applySelectionChanges(changes, cur));
    },
    [setSelectedEdgeIds],
  );

  const onConnect = useCallback<(connection: Connection) => void>(
    (connection) => {
      diagramStore.addEdge(
        path,
        connection.source,
        connection.target,
        { edgeType: 'blank-solid', label: '', direction: 'forward', properties: {} },
        connection.sourceHandle,
        connection.targetHandle,
      );
    },
    [diagramStore, path],
  );

  const onAddNode = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const def = NODE_TYPES.find((n) => n.id === typeId);
      if (!def) return;
      diagramStore.addNode(path, 'typed', position, {
        nodeType: typeId,
        label: def.label,
        description: '',
        properties: { ...(def.defaultProperties ?? {}) },
        tags: [],
      });
    },
    [diagramStore, path],
  );

  const onAddGroup = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const def = GROUP_TYPES.find((g) => g.id === typeId);
      if (!def) return;
      const id = diagramStore.addNode(path, 'group', position, {
        nodeType: typeId,
        label: def.label,
        description: '',
        properties: {},
        tags: [],
      });
      diagramStore.updateDimensions(id, 320, 220);
    },
    [diagramStore, path],
  );

  const onAddText = useCallback(
    (position: { x: number; y: number }): string => {
      return diagramStore.addNode(path, 'text', position, {
        nodeType: 'text',
        label: '',
        description: '',
        properties: {},
        tags: [],
        textColor: '#e7e9ee',
        fontSize: 16,
      });
    },
    [diagramStore, path],
  );

  const onAddShape = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const fullDef = globalShapeRegistry.getShape(typeId);
      const def = fullDef
        ? {
            id: fullDef.id,
            defaultWidth: fullDef.defaults.width,
            defaultHeight: fullDef.defaults.height,
            color: fullDef.defaults.color,
            label: fullDef.defaults.label ?? '',
          }
        : SHAPE_TYPES.find((s) => s.id === typeId);
      if (!def) return;
      const id = diagramStore.addNode(path, 'shape', position, {
        nodeType: typeId,
        label: (def as { label?: string }).label ?? '',
        description: '',
        properties: {},
        tags: [],
        color: (def as { color?: string }).color,
      });
      diagramStore.updateDimensions(id, def.defaultWidth, def.defaultHeight);
    },
    [diagramStore, path],
  );

  const onAddCode = useCallback(
    (position: { x: number; y: number }): string => {
      const id = diagramStore.addNode(path, 'code', position, {
        nodeType: 'code',
        label: '',
        description: '',
        properties: {},
        tags: [],
        codeContent: '',
        codeLanguage: 'json',
      });
      diagramStore.updateDimensions(id, 320, 220);
      return id;
    },
    [diagramStore, path],
  );

  // Called after dragging a regular node - see Canvas.tsx's onNodeDragStop.
  // newParentId is the group it now overlaps, or null if it's no longer over
  // any group. Converts position to/from parent-relative coordinates so the
  // node visually stays where the user dropped it.
  const onReparentNode = useCallback(
    (nodeId: string, newParentId: string | null) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const currentParentId = node.parentId ?? null;
      if (currentParentId === newParentId) return;
      // Boundaries nest, so a boundary must never end up inside itself or
      // inside something it already contains - that would be a cycle.
      if (newParentId && (newParentId === nodeId || isDescendantOf(newParentId, nodeId, nodes)))
        return;

      const absolute = toAbsolutePosition(node, nodes, node.parentId);
      const nextPosition = toRelativePosition(absolute, nodes, newParentId ?? undefined);

      // Dropped at the end of a gesture whose commit is still pending: apply
      // it inside that commit, after the positions, so this node is written
      // once and its position is the one relative to its new parent.
      if (commitScheduled.current) {
        pendingReparents.current.set(nodeId, newParentId ?? undefined);
        return;
      }
      diagramStore.updateParentId(nodeId, newParentId ?? undefined, nextPosition);
    },
    [nodes, diagramStore],
  );

  // Called after dragging or resizing a *boundary* - see Canvas.tsx's onNodeDragStop
  // and GroupNode.tsx's onResizeEnd.
  // `nodeIds` are whichever nodes now fall fully inside it - boundaries
  // included, since they nest. selectNodesToAdopt narrows that down to the
  // outermost ones: a nested boundary is adopted, its own contents stay
  // with it. Any node already parented to a different group gets moved
  // over (its position is re-derived relative to the new parent, same math
  // as onReparentNode). `groupPosition`, when given, is the group's
  // position relative to its own current parent, like any node position.
  const onAdoptIntoGroup = useCallback(
    (groupId: string, nodeIds: string[], groupPosition?: { x: number; y: number }) => {
      // Read at call time, not captured: this callback travels through
      // CanvasContext, so depending on `nodes` gave it a new identity on every
      // change, and every node and edge component re-rendered with it (WS1-R8).
      const current = nodesRef.current;
      const group = current.find((n) => n.id === groupId);
      if (!group) return;
      const groupAbsolute = toAbsolutePosition(
        { position: groupPosition ?? group.position },
        current,
        group.parentId,
      );
      for (const nodeId of selectNodesToAdopt(groupId, nodeIds, current)) {
        const n = current.find((nn) => nn.id === nodeId);
        if (!n) continue;
        const absolute = toAbsolutePosition(n, current, n.parentId);
        const relative = { x: absolute.x - groupAbsolute.x, y: absolute.y - groupAbsolute.y };
        diagramStore.updateParentId(nodeId, groupId, relative);
      }
    },
    [diagramStore],
  );

  const onUpdateNode = useCallback((id: string, patch: Partial<ArchNodeData>) => {
    diagramStoreRef.current.updateNode(id, patch);
  }, []);

  /**
   * Applies a z-order command to the current selection.
   *
   * Lives here rather than in the Inspector because reordering is
   * inherently relative - working out what "in front" means needs every
   * node's geometry, and the Inspector only ever sees the one that's
   * selected.
   *
   * The width/height fallback matches Canvas's own: a content-sized node
   * carries no explicit width, only a measured one, and reading n.width
   * alone would score all of them as zero-area.
   */
  const onZOrderCommand = useCallback(
    (command: ZOrderCommand, targetIds?: string[]) => {
      // Defaults to the selection for the Inspector's buttons; the
      // context menu passes targets explicitly, since right-clicking an
      // unselected node should act on THAT node.
      const ids = targetIds ?? selectedNodeIds;
      const boxes = nodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? n.measured?.width ?? 0,
        height: n.height ?? n.measured?.height ?? 0,
        zIndex: n.data.zIndex,
      }));
      // An empty result means the command wouldn't change anything -
      // skip the store write rather than syncing a no-op to every peer.
      for (const patch of applyZOrderCommand(boxes, ids, command)) {
        diagramStoreRef.current.updateNode(patch.id, { zIndex: patch.zIndex });
      }
    },
    [nodes, selectedNodeIds],
  );

  const onUpdateEdge = useCallback((id: string, patch: ArchEdgeDataPatch) => {
    diagramStoreRef.current.updateEdge(id, patch);
  }, []);

  /**
   * Edge manipulation - moving an edge's ends onto different nodes, and
   * bending its route with waypoints.
   *
   * All five go through diagramStoreRef rather than `diagramStore`
   * directly, for the same reason onUpdateNode/onUpdateEdge already do:
   * they're called from event handlers (some of them on every frame of a
   * drag), and the ref is what decides whether the write lands in local
   * state or the session's shared document without every one of these
   * needing to be rebuilt when a session starts or ends.
   *
   * Each one is a distinct named store operation rather than a patch of
   * the edge's data. Endpoints can't be expressed as a data patch at all
   * - they're top-level React Flow Edge fields - and waypoints must not
   * be, because replacing the whole list is exactly what stops
   * concurrent edits to it from merging. See DiagramStore for the full
   * reasoning.
   */
  const onReconnectEdge = useCallback((edgeId: string, endpoints: EdgeEndpoints) => {
    diagramStoreRef.current.reconnectEdge(edgeId, endpoints);
  }, []);

  /**
   * Bend drags are gestures (WS4-R1): adding and moving record into the edge's
   * in-flight gesture, shown once per frame and broadcast to peers, and
   * onEndEdgeGesture writes the result once (WS4-R2).
   */
  const edgeFlushHandle = useRef<number | null>(null);
  const publishEdgeGestures = useCallback(() => {
    edgeFlushHandle.current = null;
    const snapshot = new Map(edgeGesturesRef.current);
    setEdgeInFlight(snapshot.size ? snapshot : NO_EDGE_GESTURES);
    const edges: Record<string, EdgeWaypoint[]> = {};
    const labels: Record<string, LabelPlacement> = {};
    for (const [edgeId, gesture] of snapshot) {
      if (changesWaypoints(gesture)) {
        const stored = diagramStoreRef.current.getSnapshot().edges.find((e) => e.id === edgeId)
          ?.data?.waypoints;
        edges[edgeId] = applyEdgeGesture(stored, gesture);
      }
      if (gesture.label) labels[edgeId] = gesture.label;
    }
    broadcastPresence({
      edgeGesture: snapshot.size ? { path: path.join('/'), edges, labels } : null,
    });
  }, [broadcastPresence, path]);
  const scheduleEdgePublish = useCallback(() => {
    if (edgeFlushHandle.current === null)
      edgeFlushHandle.current = requestAnimationFrame(publishEdgeGestures);
  }, [publishEdgeGestures]);

  const onAddEdgeWaypoint = useCallback(
    (edgeId: string, index: number, waypoint: EdgeWaypoint) => {
      const current = edgeGesturesRef.current.get(edgeId);
      edgeGesturesRef.current.set(edgeId, {
        ...current,
        created: { index, waypoint },
        moved: current?.moved ?? new Map(),
      });
      scheduleEdgePublish();
    },
    [scheduleEdgePublish],
  );

  const onMoveEdgeWaypoint = useCallback(
    (edgeId: string, waypointId: string, position: { x: number; y: number }) => {
      const current = edgeGesturesRef.current.get(edgeId);
      const moved = new Map(current?.moved ?? []);
      moved.set(waypointId, position);
      edgeGesturesRef.current.set(edgeId, { ...current, created: current?.created, moved });
      scheduleEdgePublish();
    },
    [scheduleEdgePublish],
  );

  /** A label being dragged: previewed like a bend, written once at the end. */
  const onPreviewEdgeLabel = useCallback(
    (edgeId: string, placement: LabelPlacement) => {
      const current = edgeGesturesRef.current.get(edgeId);
      edgeGesturesRef.current.set(edgeId, {
        ...current,
        moved: current?.moved ?? new Map(),
        label: placement,
      });
      scheduleEdgePublish();
    },
    [scheduleEdgePublish],
  );

  const onEndEdgeGesture = useCallback(
    (edgeId: string) => {
      const gesture = edgeGesturesRef.current.get(edgeId);
      if (!gesture) return;
      edgeGesturesRef.current.delete(edgeId);
      if (edgeFlushHandle.current !== null) {
        cancelAnimationFrame(edgeFlushHandle.current);
        edgeFlushHandle.current = null;
      }
      const { add, moves, label } = edgeGestureWrites(gesture);
      // One transaction under the undo origin: one sync update, one undo step.
      undo.transact(() => {
        if (add) diagramStore.addEdgeWaypoint(edgeId, add.index, add.waypoint);
        for (const m of moves) diagramStore.moveEdgeWaypoint(edgeId, m.id, { x: m.x, y: m.y });
        if (label) diagramStore.updateEdge(edgeId, label);
      });
      // Cleared in the same batch as the store notification: no frame shows
      // the bend back where it started.
      publishEdgeGestures();
    },
    [undo, diagramStore, publishEdgeGestures],
  );

  const onRemoveEdgeWaypoint = useCallback((edgeId: string, waypointId: string) => {
    diagramStoreRef.current.removeEdgeWaypoint(edgeId, waypointId);
  }, []);

  const onClearEdgeWaypoints = useCallback((edgeId: string) => {
    diagramStoreRef.current.clearEdgeWaypoints(edgeId);
  }, []);

  // Deleting a node also drops any edges attached to it. Deleting a group
  // releases the nodes inside it (converted back to absolute position)
  // rather than deleting them - see the hint text in Inspector.tsx. Deleting
  // a node that has a populated sub-diagram asks for confirmation first,
  // since that would take everything nested inside it along with it.
  const onDeleteNode = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id);
      if (!target) return;
      const nestedCount = getNodesAtPath(diagramStore.getSnapshot().nodes, [...path, id]).length;
      if (nestedCount > 0) {
        const ok = window.confirm(
          `"${target.data.label}" contains a sub-diagram with ${nestedCount} node${nestedCount === 1 ? '' : 's'} inside. Delete it and everything inside?`,
        );
        if (!ok) return;
      }
      // Release any group children BEFORE deleting - deleteNode's own
      // cascade only removes DESCENDANTS at deeper tree levels; group
      // children (same-level, parentId containment) are a different,
      // unrelated concept that deliberately stays the UI's job (see
      // diagramStore.ts's own doc comment on deleteNode).
      // Boundaries nest, so the children are handed to the deleted
      // boundary's own parent (if any) rather than dropped onto the canvas.
      // Read from the store rather than `nodes`: deleting a selection calls
      // this once per node without a re-render in between, and an outer
      // boundary deleted a moment ago must not be picked as the new parent.
      const live = getNodesAtPath(diagramStore.getSnapshot().nodes, path);
      const liveTarget = live.find((n) => n.id === id);
      const newParentId = liveTarget?.parentId;
      for (const child of live) {
        if (child.parentId !== id) continue;
        const absolute = toAbsolutePosition(child, live, id);
        diagramStore.updateParentId(
          child.id,
          newParentId,
          toRelativePosition(absolute, live, newParentId),
        );
      }
      diagramStore.deleteNode(id);
      setSelectedNodeIds((cur) => cur.filter((n) => n !== id));
    },
    [nodes, path, diagramStore, setSelectedNodeIds],
  );

  const onDeleteEdge = useCallback(
    (id: string) => {
      diagramStore.deleteEdge(id);
      setSelectedEdgeIds((cur) => cur.filter((e) => e !== id));
    },
    [diagramStore, setSelectedEdgeIds],
  );

  const onDeleteSelection = useCallback(() => {
    selectedEdgeIds.forEach(onDeleteEdge);
    selectedNodeIds.forEach(onDeleteNode);
  }, [selectedNodeIds, selectedEdgeIds, onDeleteNode, onDeleteEdge]);

  // --- Sub-diagram navigation ---------------------------------------------

  const onDrillInto = useCallback(
    (nodeId: string) => {
      if (isPresenting) return;
      setPath((p) => [...p, nodeId]);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setActiveStepId(null);
    },
    [isPresenting, setPath, setSelectedNodeIds, setSelectedEdgeIds, setActiveStepId],
  );

  const onNavigateToRoot = useCallback(() => {
    setPath([]);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setActiveStepId(null);
  }, [setPath, setSelectedNodeIds, setSelectedEdgeIds, setActiveStepId]);

  const onNavigateToPathIndex = useCallback(
    (index: number) => {
      setPath((p) => p.slice(0, index + 1));
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setActiveStepId(null);
    },
    [setPath, setSelectedNodeIds, setSelectedEdgeIds, setActiveStepId],
  );

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onAddNode,
    onAddGroup,
    onAddText,
    onAddShape,
    onAddCode,
    onReparentNode,
    onAdoptIntoGroup,
    onUpdateNode,
    onZOrderCommand,
    onUpdateEdge,
    onReconnectEdge,
    onAddEdgeWaypoint,
    onMoveEdgeWaypoint,
    onPreviewEdgeLabel,
    onEndEdgeGesture,
    onRemoveEdgeWaypoint,
    onClearEdgeWaypoints,
    onDeleteNode,
    onDeleteEdge,
    onDeleteSelection,
    onDrillInto,
    onNavigateToRoot,
    onNavigateToPathIndex,
  };
}
