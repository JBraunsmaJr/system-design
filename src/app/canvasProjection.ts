import type { Node, Edge } from '@xyflow/react';
import { getNodesAtPath, getEdgesAtPath, levelKey } from '../collab/stores/diagramStore';
import { reorderWithGroupsFirst } from '../domain/canvas/graphUtils';
import { computeEffectiveZIndices } from '../domain/canvas/zOrder';
import {
  applyInFlight,
  applyEdgeGesture,
  changesWaypoints,
  type InFlightMap,
  type EdgeGestureMap,
  type LabelPlacement,
} from '../domain/canvas/gestureGeometry';
import type { DiagramPath } from '../domain/canvas/subDiagramTree';
import type { ArchNodeData, ArchEdgeData, EdgeWaypoint } from '../domain/canvas/types';

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
 * object - does not also give it new `data`. Memoised node components compare
 * `data` by identity, so this is what lets them skip those renders.
 */
const derivedNodeData = new WeakMap<
  Node<ArchNodeData>,
  { hasSub: boolean; subCount: number; data: ArchNodeData }
>();

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
  } = input;
  const rawNodes = reorderWithGroupsFirst(getNodesAtPath(diagramSnapshot.nodes, path));
  const rawEdges = getEdgesAtPath(diagramSnapshot.edges, path);
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
