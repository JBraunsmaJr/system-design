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
