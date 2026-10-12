import type {Edge, Node} from '@xyflow/react';
import {getEdgesAtPath, getNodesAtPath, levelKey} from '../collab/stores/diagramStore';
import {reorderWithGroupsFirst} from '../domain/canvas/graphUtils';
import {computeEffectiveZIndices} from '../domain/canvas/zOrder';
import {
    applyEdgeGesture,
    applyInFlight,
    changesWaypoints,
    type EdgeGestureMap,
    type InFlightMap,
    type LabelPlacement,
} from '../domain/canvas/gestureGeometry';
import type {DiagramPath} from '../domain/canvas/subDiagramTree';
import type {ArchEdgeData, ArchNodeData, EdgeWaypoint} from '../domain/canvas/types';
import {
    type BoundaryPort,
    type BoundaryPortNodeData,
    type PortIndex,
    portsForLevel,
    unwiredPortCounts,
} from '../domain/canvas/boundaryPorts';

/*
 * PERFORMANCE: these caches are module-level WeakMaps on purpose, and must
 * stay that way. They are what keeps an unchanged node the SAME object from
 * one render to the next, which is the only reason React Flow and the
 * memoized node components skip it (WS1-R8). Moving them into component
 * state or a ref would give each mounted App its own cache - harmless - but
 * moving them into a useMemo, or recreating them per call, would hand every
 * node a new object on every change and re-render all of them.
 */

/**
 * The objects the canvas was last handed for each store node/edge, reused
 * while every derived input is unchanged. Keyed by the store's own object,
 * which the store itself keeps stable for anything a change did not touch
 * (yjsDiagramStore.ts) - so a drag re-renders the dragged node, not all of
 * them. Weak, so entries go when the store drops the source object.
 */
const derivedNodes = new WeakMap<
  Node<ArchNodeData>,
  {
    zIndex: number | undefined;
    measured: Node['measured'];
    selected: boolean;
    hasSub: boolean;
    subCount: number;
    unwired: number;
    out: Node<ArchNodeData>;
  }
>();
const derivedEdges = new WeakMap<
  Edge<ArchEdgeData>,
  { selected: boolean; out: Edge<ArchEdgeData> }
>();
/**
 * The `data` object handed to each node, kept separately so that a change to
 * only its measured size, selection or stacking - which gives the node a new
 * object - does not also give it new `data`. Memoized node components compare
 * `data` by identity, so this is what lets them skip those renders.
 */
const derivedNodeData = new WeakMap<
  Node<ArchNodeData>,
    { hasSub: boolean; subCount: number; unwired: number; data: ArchNodeData }
>();

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

export interface CanvasProjectionInput {
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  subDiagramLevelCounts: ReadonlyMap<string, number>;
  path: DiagramPath;
  selectedNodeIds: readonly string[];
  selectedEdgeIds: readonly string[];
  measuredDimensions: ReadonlyMap<string, { width: number; height: number }>;
  inFlight: InFlightMap;
  peerInFlight: InFlightMap;
  edgeInFlight: EdgeGestureMap;
  peerEdgeInFlight: ReadonlyMap<string, unknown>;
  peerEdgeLabels: ReadonlyMap<string, LabelPlacement>;
  /** Boundary-port state for the whole document (boundaryPorts.ts). Omit
   * to project without it - no unwired counts, and orphaned wires are not
   * filtered out. */
  portIndex?: PortIndex;
}

/**
 * What the canvas renders at `path`: the document's nodes and edges with
 * selection, stacking, measured size, sub-diagram counts and in-flight
 * gesture geometry folded in.
 *
 * The body of App.tsx's nodes/edges useMemo, moved unchanged so it can be
 * tested directly. It must still only be called from inside a useMemo keyed
 * on every input field; calling it on every render would redo the z-order
 * pass per render, even though the caches above would keep the output
 * objects stable.
 */
export function projectCanvasElements(input: CanvasProjectionInput): {
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
} {
  const {
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
    portIndex,
  } = input;
  const rawNodes = reorderWithGroupsFirst(getNodesAtPath(diagramSnapshot.nodes, path));
  // Wires whose port no longer exists are orphans left by a peer's edit or
  // an old file; the operation that orphans one deletes it, but until
  // then it must not render as a dangling edge.
  const levelEdges = getEdgesAtPath(diagramSnapshot.edges, path);
  const rawEdges = portIndex ? levelEdges.filter((e) => portIndex.isValidEdge(e.id)) : levelEdges;
  const unwiredByNode = portIndex ? unwiredPortCounts(portIndex, path) : NO_COUNTS;
  /**
   * Keyed only on what the ordering actually depends on - id, size and
   * any explicit override. Position is deliberately excluded: the rule
   * is area-based, so recomputing while something is dragged would be
   * pure waste on every animation frame.
   */
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
      // Stacking order, folded into this existing pass rather than computed
      // again downstream - see domain/zOrder.ts for the rule. Derived from
      // live geometry so a rectangle enlarged to enclose more nodes drops
      // behind them without anyone reordering anything.
      const zIndex = zIndices.get(n.id);
      // Re-attached because React Flow reads `measured` EXCLUSIVELY off the
      // node object the app hands it (adoptUserNodes) and does not carry its
      // own previous value forward - so a node the store rebuilds would
      // otherwise lose its measured size until a re-measure a frame later.
      // This is each client's OWN measurement of its OWN DOM, deliberately
      // never sent over the session - see isAutoSizedNodeType.
      const measured = measuredDimensions.get(n.id) ?? n.measured;
      const selected = selectedNodes.has(n.id);
      const subCount = subDiagramLevelCounts.get(levelKey([...path, n.id])) ?? 0;
      const hasSub = subCount > 0;
      // Only a node with something inside can be out of step with it.
      const unwired = hasSub ? (unwiredByNode.get(n.id) ?? 0) : 0;
      // Same inputs, same object (WS1-R8): React Flow skips a node whose
      // object is identical to last time, and re-renders it otherwise.
      const hit = derivedNodes.get(n);
      let out: Node<ArchNodeData>;
      if (
        hit &&
        hit.zIndex === zIndex &&
        hit.measured === measured &&
        hit.selected === selected &&
        hit.hasSub === hasSub &&
          hit.subCount === subCount &&
          hit.unwired === unwired
      ) {
        out = hit.out;
      } else {
        let dataHit = derivedNodeData.get(n);
        if (
            !dataHit ||
            dataHit.hasSub !== hasSub ||
            dataHit.subCount !== subCount ||
            dataHit.unwired !== unwired
        ) {
          const data: ArchNodeData = {
            ...n.data,
            hasSubDiagram: hasSub,
            subDiagramNodeCount: subCount,
          };
          if (unwired > 0) data.unwiredPortCount = unwired;
          else delete data.unwiredPortCount;
            dataHit = {hasSub, subCount, unwired, data};
          derivedNodeData.set(n, dataHit);
        }
        out = { ...n, zIndex, measured, selected, data: dataHit.data };
          // A locked node can't be dragged or arrow-key nudged - React Flow
          // honors draggable:false for both. Only set when locked, so an
          // unlocked node's object is exactly what it was before locking
          // existed. A change to `locked` is a change to the store's node
          // object, so the cache above can't hand back a stale answer.
          if (n.data.locked) {
              out.draggable = false;
              out.className = 'is-locked';
          }
          derivedNodes.set(n, {zIndex, measured, selected, hasSub, subCount, unwired, out});
      }
      // In-flight geometry over the document's (WS4-R1, WS4-R3): this
      // user's own gesture first, since they are the one holding the node.
      // Only the moving nodes get a new object, so only they re-render.
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
      // In-flight bends and labels, this user's first; only those edges get
      // new objects.
      const own = edgeInFlight.get(e.id);
      const peer = own ? undefined : peerEdgeInFlight.get(e.id);
      const label = own ? own.label : peerEdgeLabels.get(e.id);
      if (!own && !peer && !label) return out;
      const data = { ...(out.data as ArchEdgeData) };
      if (own && changesWaypoints(own)) data.waypoints = applyEdgeGesture(out.data?.waypoints, own);
      else if (peer) data.waypoints = peer as EdgeWaypoint[];
      if (label) Object.assign(data, label);
      return { ...out, data };
    }),
  };
}

/** Horizontal gap between the outermost node and the port column, and the
 * vertical pitch between ports. */
const PORT_GAP_X = 120;
const PORT_PITCH_Y = 64;
const PORT_WIDTH = 200;

/** Same object while a port's inputs are unchanged, for the same reason as
 * the node caches above. Keyed by port id, which is stable. */
const derivedPorts = new Map<string, { key: string; out: Node<BoundaryPortNodeData> }>();

/**
 * The ports to draw on the boundary of the sub-diagram at `path` - inbound
 * in a column to the left of everything at this level, outbound to the
 * right, both starting level with the topmost node.
 *
 * Laid out from the document's own positions, not in-flight ones, so the
 * ports hold still while something is being dragged and move once it's
 * dropped. They're not draggable, selectable or deletable: they belong to
 * the level above, and the only thing to do with one here is wire it.
 */
export function projectBoundaryPorts(input: {
  portIndex: PortIndex;
  path: DiagramPath;
  diagramSnapshot: { nodes: Node<ArchNodeData>[] };
  measuredDimensions: ReadonlyMap<string, { width: number; height: number }>;
}): Node<BoundaryPortNodeData>[] {
    const {portIndex, path, diagramSnapshot, measuredDimensions} = input;
  const ports = portsForLevel(portIndex, path);
  if (ports.length === 0) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  // Children of a boundary sit inside it, so the top-level nodes alone
  // give the extent of the level.
  for (const n of getNodesAtPath(diagramSnapshot.nodes, path)) {
    if (n.parentId) continue;
    const width = n.width ?? measuredDimensions.get(n.id)?.width ?? n.measured?.width ?? 180;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + width);
  }
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 400;
  }

  const inbound = ports.filter((p) => p.side === 'in');
  const outbound = ports.filter((p) => p.side === 'out');
  const column = (list: BoundaryPort[], x: number) =>
      list.map((port, i) => {
          const position = {x, y: minY + i * PORT_PITCH_Y};
          // Re-attached for the same reason as document nodes' `measured`: a
          // port that moves gets a new object, and React Flow would otherwise
          // drop its size until a re-measure that never comes (the size itself
          // didn't change, so its ResizeObserver doesn't fire).
          const measured = measuredDimensions.get(port.id);
          const key = [
              measured ? `${measured.width}x${measured.height}` : '',
              position.x,
              position.y,
              port.peerLabel,
              port.connectionLabel,
              port.bound,
              port.color ?? '',
              port.edgeType,
              port.peerDepth,
          ].join('|');
          const hit = derivedPorts.get(port.id);
          if (hit && hit.key === key) return hit.out;
          const out: Node<BoundaryPortNodeData> = {
              id: port.id,
              type: 'port',
              // React Flow only marks DRAGGABLE nodes `nopan`; without it the
              // pane's zoom handler swallows a double-click on the port before
              // the node sees it.
              className: 'nopan',
              position,
              draggable: false,
              selectable: false,
              deletable: false,
              focusable: false,
              connectable: true,
              ...(measured ? {measured} : {}),
              data: {
                  nodeType: 'port',
                  label: port.peerLabel,
                  properties: {},
                  tags: [],
                  port,
              },
          };
          derivedPorts.set(port.id, {key, out});
          return out;
      });

  const result = [
    ...column(inbound, minX - PORT_GAP_X - PORT_WIDTH),
    ...column(outbound, maxX + PORT_GAP_X),
  ];
  // Only one level is on screen at a time, so anything not in it is stale.
  if (derivedPorts.size > result.length) {
    const live = new Set(result.map((n) => n.id));
    for (const id of derivedPorts.keys()) if (!live.has(id)) derivedPorts.delete(id);
  }
  return result;
}
