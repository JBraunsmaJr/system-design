/**
 * In-flight gesture geometry (WS4-R1, WS4-R2, WS4-R3).
 *
 * While a node is being dragged or resized, its geometry changes every frame.
 * Writing each frame to the Y.Doc is what WS4 exists to stop: overwriting a
 * Y.Map key leaves a tombstone, and round-robin writes across several nodes -
 * a multi-select drag - leave roughly ten bytes behind per write, forever.
 * The document also re-rendered and synced on every frame.
 *
 * So geometry during a gesture lives here instead: as a local overlay the
 * canvas renders from, and (in a session) as Awareness state peers render
 * from. When the gesture ends it is written to the document once per node.
 *
 * Pure and dependency-free so the rules are testable without a browser.
 */
import type { PendingNodeUpdate } from "./nodeChangeBatching.ts";

export interface InFlightGeometry {
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}

export type InFlightMap = ReadonlyMap<string, InFlightGeometry>;

export const NO_IN_FLIGHT: InFlightMap = new Map();

/**
 * Folds one frame's pending updates into the overlay, keeping whatever each
 * node already had - a resize from a corner moves AND resizes, and the two
 * arrive as separate changes.
 */
export function mergeInFlight(
  current: InFlightMap,
  pending: ReadonlyMap<string, PendingNodeUpdate>
): Map<string, InFlightGeometry> {
  const next = new Map(current);
  for (const [id, update] of pending) {
    const prev = next.get(id) ?? {};
    next.set(
      id,
      update.type === "position"
        ? { ...prev, position: update.position }
        : { ...prev, width: update.width, height: update.height }
    );
  }
  return next;
}

/** A node with in-flight geometry laid over what the document holds. */
export function applyInFlight<N extends { position: { x: number; y: number }; width?: number; height?: number }>(
  node: N,
  geometry: InFlightGeometry | undefined
): N {
  if (!geometry) return node;
  const next = { ...node };
  if (geometry.position) next.position = geometry.position;
  if ("width" in geometry) next.width = geometry.width;
  if ("height" in geometry) next.height = geometry.height;
  return next;
}

/**
 * The shape broadcast over Awareness. `path` is the diagram level as the
 * presence layer already encodes it (ids joined with "/"), so a peer only
 * applies geometry for the level it is looking at.
 */
export interface GestureBroadcast {
  path: string;
  nodes: Record<string, InFlightGeometry>;
}

export function toBroadcast(path: string, inFlight: InFlightMap): GestureBroadcast | null {
  if (inFlight.size === 0) return null;
  return { path, nodes: Object.fromEntries(inFlight) };
}

/** Upper bound on nodes accepted from one peer's broadcast. Awareness is
 * untrusted input, and the overlay is applied on every render. */
export const MAX_BROADCAST_NODES = 500;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validates a peer's broadcast. Anything malformed is dropped rather than
 * trusted: this geometry is rendered directly, and a NaN position would take
 * a node off the canvas.
 */
export function parseGestureBroadcast(raw: unknown): GestureBroadcast | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { path?: unknown; nodes?: unknown };
  if (typeof candidate.path !== "string" || !candidate.nodes || typeof candidate.nodes !== "object") return null;
  const nodes: Record<string, InFlightGeometry> = {};
  let count = 0;
  for (const [id, value] of Object.entries(candidate.nodes as Record<string, unknown>)) {
    if (count >= MAX_BROADCAST_NODES) break;
    if (!value || typeof value !== "object") continue;
    const g = value as { position?: { x?: unknown; y?: unknown }; width?: unknown; height?: unknown };
    const out: InFlightGeometry = {};
    if (g.position && finite(g.position.x) && finite(g.position.y)) out.position = { x: g.position.x, y: g.position.y };
    if (finite(g.width) && g.width > 0) out.width = g.width;
    if (finite(g.height) && g.height > 0) out.height = g.height;
    if (out.position || out.width !== undefined || out.height !== undefined) {
      nodes[id] = out;
      count++;
    }
  }
  return count > 0 ? { path: candidate.path, nodes } : null;
}

/**
 * Remote in-flight geometry for the level `path`, from every peer that is
 * mid-gesture there. Local in-flight geometry is applied separately and wins,
 * since this user is the one holding those nodes.
 */
export function remoteInFlight(
  peers: ReadonlyArray<{ gesture?: GestureBroadcast | null }>,
  path: string
): InFlightMap {
  let result: Map<string, InFlightGeometry> | null = null;
  for (const peer of peers) {
    if (!peer.gesture || peer.gesture.path !== path) continue;
    result ??= new Map();
    for (const [id, g] of Object.entries(peer.gesture.nodes)) result.set(id, g);
  }
  return result ?? NO_IN_FLIGHT;
}

// ---------------------------------------------------------------------------
// Edge bends (WS4-R1 applied to waypoints): dragging a bend, or dragging a
// new one out of an edge, is a gesture like dragging a node. It used to write
// the waypoint on every pointer move.

export interface WaypointLike {
  id: string;
  x: number;
  y: number;
}

/** Where an edge's label sits: a point along the path plus an offset. */
export interface LabelPlacement {
  labelAnchorT: number;
  labelOffsetX: number;
  labelOffsetY: number;
}

/** One edge's in-flight gesture: bends and/or its label. */
export interface EdgeGesture {
  /** The label being dragged, when it is. Written once when the drag ends. */
  label?: LabelPlacement;
  /** A bend created by this gesture: not in the document until it ends. */
  created?: { index: number; waypoint: WaypointLike };
  /** Current positions of bends moved by this gesture, by id. */
  moved: ReadonlyMap<string, { x: number; y: number }>;
}

export type EdgeGestureMap = ReadonlyMap<string, EdgeGesture>;
export const NO_EDGE_GESTURES: EdgeGestureMap = new Map();

/** The waypoints to draw for an edge mid-gesture. */
export function applyEdgeGesture<W extends WaypointLike>(base: readonly W[] | undefined, gesture: EdgeGesture): W[] {
  const list: W[] = [...(base ?? [])];
  const created = gesture.created;
  if (created && !list.some((w) => w.id === created.waypoint.id)) {
    list.splice(Math.max(0, Math.min(created.index, list.length)), 0, { ...created.waypoint } as W);
  }
  return list.map((w) => {
    const at = gesture.moved.get(w.id);
    return at ? ({ ...w, x: at.x, y: at.y } as W) : w;
  });
}

/**
 * What ending the gesture writes: a created bend once, at its final place;
 * each other moved bend once, at its final place (WS4-R2).
 */
export function edgeGestureWrites(gesture: EdgeGesture): {
  add?: { index: number; waypoint: WaypointLike };
  moves: { id: string; x: number; y: number }[];
  label?: LabelPlacement;
} {
  const createdId = gesture.created?.waypoint.id;
  const add = gesture.created
    ? {
        index: gesture.created.index,
        waypoint: { ...gesture.created.waypoint, ...(gesture.moved.get(gesture.created.waypoint.id) ?? {}) },
      }
    : undefined;
  const moves = [...gesture.moved]
    .filter(([id]) => id !== createdId)
    .map(([id, at]) => ({ id, x: at.x, y: at.y }));
  return { add, moves, label: gesture.label };
}

/** Whether a gesture changes bends at all (a label-only drag does not). */
export function changesWaypoints(gesture: EdgeGesture): boolean {
  return gesture.created !== undefined || gesture.moved.size > 0;
}

/** Presence form: each in-flight edge's full waypoint list at `path`. */
export interface EdgeGestureBroadcast {
  path: string;
  edges: Record<string, WaypointLike[]>;
  /** Labels being dragged, by edge id. */
  labels?: Record<string, LabelPlacement>;
}

const MAX_BROADCAST_EDGES = 100;
const MAX_WAYPOINTS_PER_EDGE = 200;

export function parseEdgeGestureBroadcast(raw: unknown): EdgeGestureBroadcast | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { path?: unknown; edges?: unknown };
  if (typeof candidate.path !== "string" || !candidate.edges || typeof candidate.edges !== "object") return null;
  const edges: Record<string, WaypointLike[]> = {};
  const labels: Record<string, LabelPlacement> = {};
  let count = 0;
  if (candidate && typeof (candidate as { labels?: unknown }).labels === "object" && (candidate as { labels?: unknown }).labels) {
    for (const [edgeId, value] of Object.entries((candidate as { labels: Record<string, unknown> }).labels)) {
      if (count >= MAX_BROADCAST_EDGES) break;
      const l = value as Partial<LabelPlacement> | null;
      if (!l || !finite(l.labelAnchorT) || l.labelAnchorT < 0 || l.labelAnchorT > 1 || !finite(l.labelOffsetX) || !finite(l.labelOffsetY)) continue;
      labels[edgeId] = { labelAnchorT: l.labelAnchorT, labelOffsetX: l.labelOffsetX, labelOffsetY: l.labelOffsetY };
      count++;
    }
  }
  for (const [edgeId, value] of Object.entries(candidate.edges as Record<string, unknown>)) {
    if (count >= MAX_BROADCAST_EDGES) break;
    if (!Array.isArray(value) || value.length > MAX_WAYPOINTS_PER_EDGE) continue;
    const list: WaypointLike[] = [];
    let valid = true;
    for (const w of value) {
      const p = w as { id?: unknown; x?: unknown; y?: unknown };
      if (typeof p?.id !== "string" || !finite(p.x) || !finite(p.y)) {
        valid = false;
        break;
      }
      list.push({ id: p.id, x: p.x, y: p.y });
    }
    if (!valid) continue;
    edges[edgeId] = list;
    count++;
  }
  if (count === 0) return null;
  return Object.keys(labels).length > 0 ? { path: candidate.path, edges, labels } : { path: candidate.path, edges };
}

/** Peers' in-flight label placements at `path`, by edge id. */
export function remoteEdgeLabels(
  peers: ReadonlyArray<{ edgeGesture?: EdgeGestureBroadcast | null }>,
  path: string
): ReadonlyMap<string, LabelPlacement> {
  let result: Map<string, LabelPlacement> | null = null;
  for (const peer of peers) {
    const labels = peer.edgeGesture?.path === path ? peer.edgeGesture.labels : undefined;
    if (!labels) continue;
    result ??= new Map();
    for (const [id, placement] of Object.entries(labels)) result.set(id, placement);
  }
  return result ?? NO_REMOTE_LABELS;
}
const NO_REMOTE_LABELS: ReadonlyMap<string, LabelPlacement> = new Map();

/** Peers' in-flight waypoint lists at `path`, by edge id. */
export function remoteEdgeGestures(
  peers: ReadonlyArray<{ edgeGesture?: EdgeGestureBroadcast | null }>,
  path: string
): ReadonlyMap<string, WaypointLike[]> {
  let result: Map<string, WaypointLike[]> | null = null;
  for (const peer of peers) {
    if (!peer.edgeGesture || peer.edgeGesture.path !== path) continue;
    result ??= new Map();
    for (const [id, list] of Object.entries(peer.edgeGesture.edges)) result.set(id, list);
  }
  return result ?? NO_REMOTE_EDGES;
}
const NO_REMOTE_EDGES: ReadonlyMap<string, WaypointLike[]> = new Map();
