import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Node, Edge, Connection, OnNodesChange, OnEdgesChange } from '@xyflow/react';
import {
  type DiagramStore,
  getNodesAtPath,
  getEdgesAtPath,
  getBreadcrumbLabelsFlat,
  populatedLevelCounts,
  levelKey,
} from '../collab/stores/diagramStore';
import type { UndoController } from '../collab/stores/undoManager';
import type {
  ArchNodeData,
  ArchEdgeData,
  ArchEdgeDataPatch,
  EdgeWaypoint,
  SubDiagram,
} from '../domain/canvas/types';
import type { DiagramPath } from '../domain/canvas/subDiagramTree';
import type { EdgeEndpoints } from '../domain/canvas/edgeReconnect';
import {
  getDescendantIds,
  isDescendantOf,
  reorderWithGroupsFirst,
  selectNodesToAdopt,
  toAbsolutePosition,
  toRelativePosition,
} from '../domain/canvas/graphUtils';
import {
  computeEffectiveZIndices,
  applyZOrderCommand,
  type ZOrderCommand,
} from '../domain/canvas/zOrder';
import { NODE_TYPES } from '../domain/canvas/nodeRegistry';
import { GROUP_TYPES } from '../domain/canvas/groupRegistry';
import { SHAPE_TYPES, globalShapeRegistry } from '../domain/canvas/shapeRegistry';
import {
  NO_IN_FLIGHT,
  NO_EDGE_GESTURES,
  type InFlightMap,
  type EdgeGestureMap,
  type EdgeGesture,
  type LabelPlacement,
  mergeInFlight,
  applyInFlight,
  remoteEdgeGestures,
  remoteEdgeLabels,
  remoteInFlight,
  changesWaypoints,
  applyEdgeGesture,
  edgeGestureWrites,
} from '../domain/canvas/gestureGeometry';
import {
  type PendingNodeUpdate,
  type CurrentNodeGeometry,
  isAutoSizedNodeType,
  classifyNodeChanges,
  applySelectionChanges,
} from '../domain/canvas/nodeChangeBatching';
import type { PresenceInfo } from '../collab/sync/session';

// --- Memoized derived state ------------------------------------------------
const derivedNodes = new WeakMap<
  Node<ArchNodeData>,
  {
    zIndex: number | undefined;
    measured: { width: number; height: number } | undefined;
    selected: boolean;
    hasSub: boolean;
    subCount: number;
    out: Node<ArchNodeData>;
  }
>();

const derivedEdges = new WeakMap<
  Edge<ArchEdgeData>,
  {
    selected: boolean;
    out: Edge<ArchEdgeData>;
  }
>();

const derivedNodeData = new WeakMap<
  Node<ArchNodeData>,
  { hasSub: boolean; subCount: number; data: ArchNodeData }
>();

export interface UseDiagramCanvasOpsOptions {
  diagramStore: DiagramStore;
  diagramSnapshot: SubDiagram;
  undo: UndoController;
  activeSession: object | null;
  presencePeers: PresenceInfo[];
  broadcastPresence: (patch: Partial<PresenceInfo>) => void;
  viewMode?: string;
}

export function useDiagramCanvasOps({
  diagramStore,
  diagramSnapshot,
  undo,
  activeSession,
  presencePeers,
  broadcastPresence,
}: UseDiagramCanvasOpsOptions) {
  const [path, setPath] = useState<DiagramPath>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const onToggleSelectMode = useCallback(() => setIsSelectMode((prev) => !prev), []);

  const diagramStoreRef = useRef(diagramStore);
  useLayoutEffect(() => {
    diagramStoreRef.current = diagramStore;
  }, [diagramStore]);

  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ diagramPath: path.join('/') });
  }, [activeSession, path, broadcastPresence]);

  const breadcrumbLabels = useMemo(
    () => getBreadcrumbLabelsFlat(diagramSnapshot.nodes, path),
    [diagramSnapshot, path],
  );

  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ selectedNodeIds, selectedEdgeIds });
  }, [activeSession, selectedNodeIds, selectedEdgeIds, broadcastPresence]);

  const [measuredDimensions, setMeasuredDimensions] = useState<
    Map<string, { width: number; height: number }>
  >(() => new Map());

  const [inFlight, setInFlight] = useState<InFlightMap>(NO_IN_FLIGHT);
  const inFlightRef = useRef<InFlightMap>(NO_IN_FLIGHT);
  const [edgeInFlight, setEdgeInFlight] = useState<EdgeGestureMap>(NO_EDGE_GESTURES);
  const edgeGesturesRef = useRef(new Map<string, EdgeGesture>());

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
  const peerInFlight = useMemo(
    () => (activeSession ? remoteInFlight(presencePeers, path.join('/')) : NO_IN_FLIGHT),
    [activeSession, presencePeers, path],
  );

  const subDiagramLevelCounts = useMemo(
    () => populatedLevelCounts(diagramSnapshot.nodes),
    [diagramSnapshot],
  );

  const { nodes, edges } = useMemo(() => {
    const rawNodes = reorderWithGroupsFirst(getNodesAtPath(diagramSnapshot.nodes, path));
    const rawEdges = getEdgesAtPath(diagramSnapshot.edges, path);

    const zIndices = computeEffectiveZIndices(
      rawNodes.map((n) => ({
        id: n.id,
        x: 0,
        y: 0,
        width: n.width ?? measuredDimensions.get(n.id)?.width ?? 0,
        height: n.height ?? measuredDimensions.get(n.id)?.height ?? 0,
        zIndex: n.data.zIndex,
      })),
    );

    const selectedNodes = new Set(selectedNodeIds);
    const selectedEdges = new Set(selectedEdgeIds);

    return {
      nodes: rawNodes.map((n) => {
        const zIndex = zIndices.get(n.id);
        const measured =
          measuredDimensions.get(n.id) ??
          (n.measured
            ? { width: n.measured.width ?? 0, height: n.measured.height ?? 0 }
            : undefined);
        const selected = selectedNodes.has(n.id);
        const subCount = subDiagramLevelCounts.get(levelKey([...path, n.id])) ?? 0;
        const hasSub = subCount > 0;

        const hit = derivedNodes.get(n);
        let out: Node<ArchNodeData>;
        if (
          hit &&
          hit.zIndex === zIndex &&
          hit.measured === measured &&
          hit.selected === selected &&
          hit.hasSub === hasSub &&
          hit.subCount === subCount
        ) {
          out = hit.out;
        } else {
          let dataHit = derivedNodeData.get(n);
          if (!dataHit || dataHit.hasSub !== hasSub || dataHit.subCount !== subCount) {
            dataHit = {
              hasSub,
              subCount,
              data: { ...n.data, hasSubDiagram: hasSub, subDiagramNodeCount: subCount },
            };
            derivedNodeData.set(n, dataHit);
          }
          out = { ...n, zIndex, measured, selected, data: dataHit.data };
          derivedNodes.set(n, { zIndex, measured, selected, hasSub, subCount, out });
        }
        return applyInFlight(out, inFlight.get(n.id) ?? peerInFlight.get(n.id));
      }),
      edges: rawEdges.map((e) => {
        const selected = selectedEdges.has(e.id);
        const hit = derivedEdges.get(e);
        let out: Edge<ArchEdgeData>;
        if (hit && hit.selected === selected) {
          out = hit.out;
        } else {
          out = { ...e, selected };
          derivedEdges.set(e, { selected, out });
        }
        const own = edgeInFlight.get(e.id);
        const peer = own ? undefined : peerEdgeInFlight.get(e.id);
        const label = own ? own.label : peerEdgeLabels.get(e.id);
        if (!own && !peer && !label) return out;
        const data = { ...(out.data as ArchEdgeData) };
        if (own && changesWaypoints(own))
          data.waypoints = applyEdgeGesture(out.data?.waypoints, own);
        else if (peer) data.waypoints = peer as EdgeWaypoint[];
        if (label) Object.assign(data, label);
        return { ...out, data };
      }),
    };
  }, [
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
  ]);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  const pendingNodeUpdates = useRef(new Map<string, PendingNodeUpdate>());
  const pendingReparents = useRef(new Map<string, string | undefined>());
  const commitScheduled = useRef(false);
  const pendingFlushHandle = useRef<number | null>(null);

  const flushPendingNodeUpdates = useCallback(() => {
    pendingFlushHandle.current = null;
    const pending = pendingNodeUpdates.current;
    if (pending.size === 0) return;
    const next = mergeInFlight(inFlightRef.current, pending);
    pending.clear();
    inFlightRef.current = next;
    setInFlight(next);
    const nodesRecord: Record<
      string,
      { position?: { x: number; y: number }; width?: number; height?: number }
    > = {};
    for (const [id, g] of next) {
      nodesRecord[id] = { position: g.position, width: g.width, height: g.height };
    }
    broadcastPresence({
      gesture: { path: path.join('/'), nodes: nodesRecord },
    });
  }, [broadcastPresence, path]);

  const scheduleInFlightPublish = useCallback(() => {
    if (pendingFlushHandle.current === null) {
      pendingFlushHandle.current = requestAnimationFrame(flushPendingNodeUpdates);
    }
  }, [flushPendingNodeUpdates]);

  const edgeFlushHandle = useRef<number | null>(null);
  const publishEdgeGestures = useCallback(() => {
    edgeFlushHandle.current = null;
    const next = new Map(edgeGesturesRef.current);
    setEdgeInFlight(next);
    const edgesRecord: Record<string, EdgeWaypoint[]> = {};
    const labelsRecord: Record<string, LabelPlacement> = {};
    for (const [edgeId, g] of next) {
      if (changesWaypoints(g)) {
        const baseWaypoints = edgesRef.current.find((e) => e.id === edgeId)?.data?.waypoints;
        edgesRecord[edgeId] = (applyEdgeGesture(baseWaypoints, g) ?? []) as EdgeWaypoint[];
      }
      if (g.label !== undefined) {
        labelsRecord[edgeId] = g.label;
      }
    }
    const hasEdges = Object.keys(edgesRecord).length > 0;
    const hasLabels = Object.keys(labelsRecord).length > 0;
    broadcastPresence({
      edgeGesture:
        hasEdges || hasLabels
          ? {
              path: path.join('/'),
              edges: edgesRecord,
              labels: hasLabels ? labelsRecord : undefined,
            }
          : null,
    });
  }, [broadcastPresence, path]);

  const scheduleEdgePublish = useCallback(() => {
    if (edgeFlushHandle.current === null) {
      edgeFlushHandle.current = requestAnimationFrame(publishEdgeGestures);
    }
  }, [publishEdgeGestures]);

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
          if (g.position && !reparents.has(id))
            diagramStoreRef.current.updatePosition(id, g.position);
          if (g.width !== undefined || g.height !== undefined)
            diagramStoreRef.current.updateDimensions(id, g.width, g.height);
        }
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
          diagramStoreRef.current.updateParentId(id, parentId, position);
        }
      });
    }
    if (inFlightRef.current.size > 0) {
      inFlightRef.current = NO_IN_FLIGHT;
      setInFlight(NO_IN_FLIGHT);
      broadcastPresence({ gesture: null });
    }
  }, [undo, broadcastPresence]);

  useEffect(() => {
    return () => {
      if (pendingFlushHandle.current !== null) cancelAnimationFrame(pendingFlushHandle.current);
    };
  }, []);

  const onNodesChange = useCallback<OnNodesChange<Node<ArchNodeData>>>(
    (changes) => {
      setSelectedNodeIds((cur) => applySelectionChanges(changes, cur));

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
          if (!next) {
            next = new Map(cur);
          }
          next.set(change.id, { width: change.dimensions.width, height: change.dimensions.height });
        }
        return next ?? cur;
      });

      const rawNodes = nodesRef.current;
      const currentNodeGeometry = new Map<string, CurrentNodeGeometry>(
        rawNodes.map((n) => [
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

      if (isActiveGesture || gestureInProgress) {
        scheduleInFlightPublish();
      }

      if (gestureEnded) {
        commitScheduled.current = true;
        queueMicrotask(() => {
          commitNodeGesture();
        });
      } else if (
        !isActiveGesture &&
        !gestureInProgress &&
        pendingNodeUpdates.current.size > 0 &&
        !commitScheduled.current
      ) {
        commitNodeGesture();
      }
    },
    [commitNodeGesture, scheduleInFlightPublish],
  );

  const onEdgesChange = useCallback<OnEdgesChange<Edge<ArchEdgeData>>>((changes) => {
    setSelectedEdgeIds((cur) => {
      let next = cur;
      for (const change of changes) {
        if (change.type === 'select') {
          if (change.selected && !next.includes(change.id)) {
            next = [...next, change.id];
          } else if (!change.selected && next.includes(change.id)) {
            next = next.filter((id) => id !== change.id);
          }
        }
      }
      return next;
    });
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
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

  const onReparentNode = useCallback(
    (nodeId: string, newParentId: string | null) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const currentParentId = node.parentId ?? null;
      if (currentParentId === newParentId) return;
      if (newParentId && (newParentId === nodeId || isDescendantOf(newParentId, nodeId, nodes)))
        return;

      pendingReparents.current.set(nodeId, newParentId ?? undefined);
    },
    [nodes],
  );

  const onAdoptIntoGroup = useCallback(
    (groupId: string, nodeIds: string[], groupPosition?: { x: number; y: number }) => {
      if (nodeIds.length === 0) return;
      const targetGroup = nodes.find((n) => n.id === groupId);
      if (!targetGroup) return;

      const toAdopt = selectNodesToAdopt(groupId, nodeIds, nodes);
      if (toAdopt.length === 0) return;

      const container = groupPosition
        ? nodes.map((n) => (n.id === groupId ? { ...n, position: groupPosition } : n))
        : nodes;
      const groupAbsolute = toAbsolutePosition(targetGroup, container, targetGroup.parentId);

      undo.transact(() => {
        for (const nodeId of toAdopt) {
          const node = nodes.find((n) => n.id === nodeId);
          if (!node) continue;
          const nodeAbsolute = toAbsolutePosition(node, container, node.parentId);
          const nextRelative = {
            x: nodeAbsolute.x - groupAbsolute.x,
            y: nodeAbsolute.y - groupAbsolute.y,
          };
          diagramStore.updateParentId(node.id, groupId, nextRelative);
        }
      });
    },
    [nodes, undo, diagramStore],
  );

  const onUpdateNode = useCallback(
    (id: string, patch: Partial<ArchNodeData>) => {
      diagramStore.updateNode(id, patch);
    },
    [diagramStore],
  );

  const onUpdateEdge = useCallback(
    (id: string, patch: ArchEdgeDataPatch) => {
      diagramStore.updateEdge(id, patch);
    },
    [diagramStore],
  );

  const onReconnectEdge = useCallback(
    (edgeId: string, endpoints: EdgeEndpoints) => {
      undo.transact(() => {
        diagramStoreRef.current.reconnectEdge(edgeId, endpoints);
      });
    },
    [undo],
  );

  const onAddEdgeWaypoint = useCallback(
    (edgeId: string, index: number, waypoint: EdgeWaypoint) => {
      const current = edgeGesturesRef.current.get(edgeId);
      edgeGesturesRef.current.set(edgeId, {
        created: { index, waypoint },
        moved: current?.moved ?? new Map(),
        label: current?.label,
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
      edgeGesturesRef.current.set(edgeId, {
        created: current?.created,
        moved,
        label: current?.label,
      });
      scheduleEdgePublish();
    },
    [scheduleEdgePublish],
  );

  const onPreviewEdgeLabel = useCallback(
    (edgeId: string, placement: LabelPlacement) => {
      const current = edgeGesturesRef.current.get(edgeId);
      edgeGesturesRef.current.set(edgeId, {
        created: current?.created,
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
      undo.transact(() => {
        if (add) diagramStoreRef.current.addEdgeWaypoint(edgeId, add.index, add.waypoint);
        for (const m of moves)
          diagramStoreRef.current.moveEdgeWaypoint(edgeId, m.id, { x: m.x, y: m.y });
        if (label) diagramStoreRef.current.updateEdge(edgeId, label);
      });
      publishEdgeGestures();
    },
    [undo, publishEdgeGestures],
  );

  const onRemoveEdgeWaypoint = useCallback((edgeId: string, waypointId: string) => {
    diagramStoreRef.current.removeEdgeWaypoint(edgeId, waypointId);
  }, []);

  const onClearEdgeWaypoints = useCallback((edgeId: string) => {
    diagramStoreRef.current.clearEdgeWaypoints(edgeId);
  }, []);

  const onDeleteNode = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id);
      if (!target) return;
      const nestedCount = getNodesAtPath(diagramStoreRef.current.getSnapshot().nodes, [
        ...path,
        id,
      ]).length;
      if (nestedCount > 0) {
        const ok = window.confirm(
          `"${target.data.label}" contains a sub-diagram with ${nestedCount} node${nestedCount === 1 ? '' : 's'} inside. Delete it and everything inside?`,
        );
        if (!ok) return;
      }
      const live = getNodesAtPath(diagramStoreRef.current.getSnapshot().nodes, path);
      const liveTarget = live.find((n) => n.id === id);
      const newParentId = liveTarget?.parentId;
      for (const child of live) {
        if (child.parentId !== id) continue;
        const absolute = toAbsolutePosition(child, live, child.parentId);
        diagramStoreRef.current.updateParentId(
          child.id,
          newParentId,
          toRelativePosition(absolute, live, newParentId),
        );
      }
      diagramStoreRef.current.deleteNode(id);
      setSelectedNodeIds((cur) => cur.filter((n) => n !== id));
    },
    [nodes, path],
  );

  const onDeleteEdge = useCallback(
    (id: string) => {
      diagramStore.deleteEdge(id);
      setSelectedEdgeIds((cur) => cur.filter((e) => e !== id));
    },
    [diagramStore],
  );

  const onDeleteSelection = useCallback(() => {
    selectedEdgeIds.forEach(onDeleteEdge);
    selectedNodeIds.forEach(onDeleteNode);
  }, [selectedNodeIds, selectedEdgeIds, onDeleteNode, onDeleteEdge]);

  const onZOrderCommand = useCallback(
    (command: ZOrderCommand, targetIds?: string[]) => {
      const ids = targetIds ?? (selectedNodeIds.length > 0 ? selectedNodeIds : null);
      if (!ids || ids.length === 0) return;
      const allBoxes = nodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? measuredDimensions.get(n.id)?.width ?? 0,
        height: n.height ?? measuredDimensions.get(n.id)?.height ?? 0,
        zIndex: n.data.zIndex,
      }));
      const patches = applyZOrderCommand(allBoxes, ids, command);
      if (patches.length === 0) return;
      undo.transact(() => {
        for (const patch of patches) {
          diagramStoreRef.current.updateNode(patch.id, { zIndex: patch.zIndex });
        }
      });
    },
    [selectedNodeIds, nodes, measuredDimensions, undo],
  );

  const onDrillInto = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || node.type === 'group') return;
      setPath([...path, nodeId]);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
    },
    [nodes, path],
  );

  const onNavigateToRoot = useCallback(() => {
    setPath([]);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, []);

  const onNavigateToPathIndex = useCallback(
    (index: number) => {
      setPath(path.slice(0, index + 1));
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
    },
    [path],
  );

  const [clipboard, setClipboard] = useState<{
    nodes: (Node<ArchNodeData> & { relativePath: string[] })[];
    edges: (Edge<ArchEdgeData> & { relativePath: string[] })[];
  } | null>(null);
  const [pasteOffset, setPasteOffset] = useState(0);

  const onCopy = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const selectedSet = new Set(selectedNodeIds);
    const containedIds = new Set<string>();
    for (const n of nodes) {
      if (!selectedSet.has(n.id) || n.type !== 'group') continue;
      for (const d of getDescendantIds(n.id, nodes)) containedIds.add(d);
    }
    const childNodes = nodes.filter((n) => containedIds.has(n.id) && !selectedSet.has(n.id));
    const toCopy = [...nodes.filter((n) => selectedSet.has(n.id)), ...childNodes];
    const copiedIds = new Set(toCopy.map((n) => n.id));

    const normalized = toCopy.map((n) => {
      if (n.parentId && !copiedIds.has(n.parentId)) {
        const absolute = toAbsolutePosition(n, nodes, n.parentId);
        return { ...n, parentId: undefined, position: absolute };
      }
      return n;
    });

    const topLevelEdges = edges.filter((e) => copiedIds.has(e.source) && copiedIds.has(e.target));

    const { nodes: allNodes, edges: allEdges } = diagramStore.getSnapshot();
    function gatherDescendants(
      nodeId: string,
      relativePath: string[],
    ): {
      nodes: (Node<ArchNodeData> & { relativePath: string[] })[];
      edges: (Edge<ArchEdgeData> & { relativePath: string[] })[];
    } {
      const childPath = [...relativePath, nodeId];
      const levelNodes = getNodesAtPath(allNodes, [...path, ...childPath]);
      const levelEdges = getEdgesAtPath(allEdges, [...path, ...childPath]);
      let result = {
        nodes: levelNodes.map((n) => ({ ...n, relativePath: childPath })),
        edges: levelEdges.map((e) => ({ ...e, relativePath: childPath })),
      };
      for (const child of levelNodes) {
        const deeper = gatherDescendants(child.id, childPath);
        result = {
          nodes: [...result.nodes, ...deeper.nodes],
          edges: [...result.edges, ...deeper.edges],
        };
      }
      return result;
    }

    let descendantNodes: (Node<ArchNodeData> & { relativePath: string[] })[] = [];
    let descendantEdges: (Edge<ArchEdgeData> & { relativePath: string[] })[] = [];
    for (const n of normalized) {
      const gathered = gatherDescendants(n.id, []);
      descendantNodes = [...descendantNodes, ...gathered.nodes];
      descendantEdges = [...descendantEdges, ...gathered.edges];
    }

    setClipboard({
      nodes: [...normalized.map((n) => ({ ...n, relativePath: [] })), ...descendantNodes],
      edges: [...topLevelEdges.map((e) => ({ ...e, relativePath: [] })), ...descendantEdges],
    });
    setPasteOffset(0);
  }, [nodes, edges, selectedNodeIds, diagramStore, path]);

  const onPaste = useCallback(() => {
    if (!clipboard || clipboard.nodes.length === 0) return;
    const offset = 40 + pasteOffset;

    const remaining = [...clipboard.nodes];
    const idMap = new Map<string, string>();
    const remapPath = (relativePath: string[]) =>
      relativePath.map((oldId) => idMap.get(oldId) ?? oldId);

    const rootPastedIds: string[] = [];
    while (remaining.length > 0) {
      const readyIndex = remaining.findIndex(
        (n) =>
          n.relativePath.every((ancestorId) => idMap.has(ancestorId)) &&
          (!n.parentId || idMap.has(n.parentId)),
      );
      if (readyIndex === -1) break;
      const [n] = remaining.splice(readyIndex, 1);

      const isTopLevel = n.relativePath.length === 0;
      const shouldOffset = isTopLevel && !n.parentId;
      const position = shouldOffset
        ? { x: n.position.x + offset, y: n.position.y + offset }
        : n.position;
      const newParentId = n.parentId ? idMap.get(n.parentId) : undefined;
      const newId = diagramStore.addNode(
        [...path, ...remapPath(n.relativePath)],
        n.type ?? 'typed',
        position,
        n.data,
      );
      idMap.set(n.id, newId);
      if (newParentId !== undefined) diagramStore.updateParentId(newId, newParentId, position);
      if (n.width !== undefined || n.height !== undefined)
        diagramStore.updateDimensions(newId, n.width, n.height);
      if (isTopLevel) rootPastedIds.push(newId);
    }

    const newEdgeIds: string[] = [];
    for (const e of clipboard.edges) {
      const newSource = idMap.get(e.source);
      const newTarget = idMap.get(e.target);
      if (!newSource || !newTarget) continue;
      const newEdgeId = diagramStore.addEdge(
        [...path, ...remapPath(e.relativePath)],
        newSource,
        newTarget,
        e.data ?? { edgeType: 'blank-solid', label: '', direction: 'forward', properties: {} },
        e.sourceHandle,
        e.targetHandle,
      );
      newEdgeIds.push(newEdgeId);
    }

    setSelectedNodeIds(rootPastedIds);
    setSelectedEdgeIds(newEdgeIds);
    setPasteOffset((p) => p + 40);
  }, [clipboard, pasteOffset, diagramStore, path]);

  const selectedNode = useMemo(() => {
    if (selectedNodeIds.length !== 1) return null;
    return nodes.find((n) => n.id === selectedNodeIds[0]) ?? null;
  }, [nodes, selectedNodeIds]);

  const selectedEdge = useMemo(() => {
    if (selectedEdgeIds.length !== 1) return null;
    return edges.find((e) => e.id === selectedEdgeIds[0]) ?? null;
  }, [edges, selectedEdgeIds]);

  return {
    path,
    setPath,
    breadcrumbLabels,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    selectedNode,
    selectedEdge,
    nodes,
    edges,
    isSelectMode,
    onToggleSelectMode,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onAddNode,
    onAddGroup,
    onAddShape,
    onAddText,
    onAddCode,
    onUpdateNode,
    onUpdateEdge,
    onDeleteNode,
    onDeleteEdge,
    onDeleteSelection,
    onReconnectEdge,
    onAddEdgeWaypoint,
    onMoveEdgeWaypoint,
    onRemoveEdgeWaypoint,
    onClearEdgeWaypoints,
    onPreviewEdgeLabel,
    onEndEdgeGesture,
    onReparentNode,
    onAdoptIntoGroup,
    onZOrderCommand,
    onDrillInto,
    onNavigateToRoot,
    onNavigateToPathIndex,
    onCopy,
    onPaste,
    onCommitGesture: commitNodeGesture,
  };
}
