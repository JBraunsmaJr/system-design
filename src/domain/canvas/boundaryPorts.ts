import type {Edge, Node} from '@xyflow/react';
import type {ArchEdgeData, ArchNodeData} from './types';
import {getEdgeType} from './edgeRegistry';
import {sourceHandleId, targetHandleId} from './edgeAnchoring';

/**
 * Boundary ports: keeping a node's sub-diagram connected to the level
 * above it.
 *
 * The model is Unreal Engine's collapsed graph. Every edge that touches a
 * node C at C's own level appears INSIDE C's sub-diagram as a port on its
 * boundary - an inbound port on the left for an edge that points at C,
 * an outbound port on the right for an edge that leaves C. Wiring a port
 * to a node inside says "this is the part of C that actually handles that
 * connection".
 *
 * Ports are never stored. They are derived from the level above on every
 * render, so they can't drift: delete the outer edge and its port is gone
 * from the inside too, add one and it appears.
 *
 * The WIRES from a port are stored, as ordinary edges at the inner level
 * whose source (inbound) or target (outbound) is the port's id. That gets
 * them everything an edge already has - merge-safe collaborative editing,
 * undo, types, labels, bends - for free. It also makes propagation free:
 * a wire from a port into node Y is itself an edge touching Y, so Y's own
 * sub-diagram grows a port for it, and so on down.
 *
 * A port id is `port:<edgeId>:<in|out>`. Edge ids are globally unique
 * across the whole tree (see diagramStore.ts), so a port id is too, and
 * the level a wire lives at already says which node's boundary it's on.
 */

export type PortSide = 'in' | 'out';

const PORT_PREFIX = 'port:';

export function portId(edgeId: string, side: PortSide): string {
    return `${PORT_PREFIX}${edgeId}:${side}`;
}

export function isPortId(id: string | null | undefined): boolean {
    return typeof id === 'string' && id.startsWith(PORT_PREFIX);
}

export function parsePortId(
    id: string | null | undefined,
): { edgeId: string; side: PortSide } | null {
    if (!isPortId(id)) return null;
    const rest = (id as string).slice(PORT_PREFIX.length);
    const cut = rest.lastIndexOf(':');
    if (cut <= 0) return null;
    const side = rest.slice(cut + 1);
    if (side !== 'in' && side !== 'out') return null;
    return {edgeId: rest.slice(0, cut), side};
}

type AnyEdge = Pick<Edge<ArchEdgeData>, 'id' | 'source' | 'target'> & { data?: ArchEdgeData };
type AnyNode = Pick<Node<ArchNodeData>, 'id'> & { data: ArchNodeData };

function parentPathOf(item: { data?: unknown }): string[] {
    return ((item.data as { parentPath?: string[] } | undefined)?.parentPath ?? []) as string[];
}

function levelKey(path: readonly string[]): string {
    return path.join('\u0000');
}

/**
 * Everything about ports that depends on the whole document, computed once
 * per snapshot in O(nodes + edges).
 */
export interface PortIndex {
    /** False for a wire whose port no longer exists - its outer edge was
     * deleted or moved off this node. Such a wire is an orphan: hidden on
     * the canvas and cleaned up by the operation that orphaned it. Edges
     * with no port endpoint are always valid. */
    isValidEdge(edgeId: string): boolean;

    /** Port ids that at least one valid wire is attached to. */
    boundPortIds: ReadonlySet<string>;
    edgesById: ReadonlyMap<string, AnyEdge>;
    nodesById: ReadonlyMap<string, AnyNode>;
    /** Valid edges per level (levelKey of their parentPath). */
    validEdgesByLevel: ReadonlyMap<string, AnyEdge[]>;
}

export function buildPortIndex(nodes: readonly AnyNode[], edges: readonly AnyEdge[]): PortIndex {
    const edgesById = new Map<string, AnyEdge>();
    for (const e of edges) edgesById.set(e.id, e);
    const nodesById = new Map<string, AnyNode>();
    for (const n of nodes) nodesById.set(n.id, n);

    const validity = new Map<string, boolean>();

    function endpointValid(edge: AnyEdge, end: 'source' | 'target', depth: number): boolean {
        const id = edge[end];
        const port = parsePortId(id);
        if (!port) return true;
        // An inbound port can only feed the inside (be a source); an outbound
        // port can only be fed (be a target).
        if (port.side === 'in' && end !== 'source') return false;
        if (port.side === 'out' && end !== 'target') return false;
        const level = parentPathOf(edge);
        if (level.length === 0) return false;
        const container = level[level.length - 1];
        const outer = edgesById.get(port.edgeId);
        if (!outer) return false;
        const outerLevel = parentPathOf(outer);
        if (levelKey(outerLevel) !== levelKey(level.slice(0, -1))) return false;
        if (port.side === 'in' ? outer.target !== container : outer.source !== container) return false;
        return valid(outer, depth + 1);
    }

    function valid(edge: AnyEdge, depth = 0): boolean {
        const cached = validity.get(edge.id);
        if (cached !== undefined) return cached;
        // Port chains follow the tree, so they can't be longer than the tree
        // is deep; the cap only guards against a hand-edited file with a cycle.
        const result =
            depth < 256 && endpointValid(edge, 'source', depth) && endpointValid(edge, 'target', depth);
        validity.set(edge.id, result);
        return result;
    }

    const boundPortIds = new Set<string>();
    const validEdgesByLevel = new Map<string, AnyEdge[]>();
    for (const e of edges) {
        if (!valid(e)) continue;
        if (isPortId(e.source)) boundPortIds.add(e.source);
        if (isPortId(e.target)) boundPortIds.add(e.target);
        const key = levelKey(parentPathOf(e));
        const list = validEdgesByLevel.get(key);
        if (list) list.push(e);
        else validEdgesByLevel.set(key, [e]);
    }

    return {
        isValidEdge: (id) => {
            const e = edgesById.get(id);
            return e ? valid(e) : false;
        },
        boundPortIds,
        edgesById,
        nodesById,
        validEdgesByLevel,
    };
}

export interface BoundaryPort {
    id: string;
    edgeId: string;
    side: PortSide;
    /** Label of the node at the far end of the connection, followed up
     * through every level of ports until a real node is reached. */
    peerLabel: string;
    peerNodeId: string | null;
    /** How many levels above this sub-diagram that node lives. 1 means the
     * level directly above. */
    peerDepth: number;
    /** The outermost connection's own label, or its type's label. */
    connectionLabel: string;
    /** The outermost connection's type - a new wire from this port starts
     * with the same type. */
    edgeType: string;
    color?: string;
    bound: boolean;
}

/** Data carried by a boundary-port node on the canvas. It is an
 * ArchNodeData only so it can travel in the same array as document nodes;
 * nothing reads it as one. */
export interface BoundaryPortNodeData extends ArchNodeData {
    port: BoundaryPort;
}

/**
 * Follows a port up the tree to the real node at the other end of the
 * connection, and the outermost edge it started from.
 */
export function resolvePortPeer(
    index: PortIndex,
    edge: AnyEdge,
    side: PortSide,
): { peerNodeId: string | null; peerLabel: string; depth: number; outermost: AnyEdge } {
    let current = edge;
    let depth = 1;
    for (let guard = 0; guard < 256; guard += 1) {
        const peerId = side === 'in' ? current.source : current.target;
        const port = parsePortId(peerId);
        if (!port) {
            const node = index.nodesById.get(peerId);
            return {
                peerNodeId: node ? peerId : null,
                peerLabel: node?.data.label?.trim() || 'Untitled',
                depth,
                outermost: current,
            };
        }
        const next = index.edgesById.get(port.edgeId);
        if (!next) break;
        current = next;
        depth += 1;
    }
    return {peerNodeId: null, peerLabel: 'Unknown', depth, outermost: current};
}

/**
 * The ports on the boundary of the sub-diagram at `path` - one per valid
 * edge that touches the container node at the level above. Inbound first,
 * then outbound, each in the edges' own order so ports don't reshuffle.
 */
export function portsForLevel(index: PortIndex, path: readonly string[]): BoundaryPort[] {
    if (path.length === 0) return [];
    const container = path[path.length - 1];
    const above = index.validEdgesByLevel.get(levelKey(path.slice(0, -1))) ?? [];
    const inbound: BoundaryPort[] = [];
    const outbound: BoundaryPort[] = [];
    for (const edge of above) {
        for (const side of ['in', 'out'] as const) {
            if ((side === 'in' ? edge.target : edge.source) !== container) continue;
            const id = portId(edge.id, side);
            const peer = resolvePortPeer(index, edge, side);
            const outerData = peer.outermost.data;
            const edgeType = outerData?.edgeType ?? 'blank-solid';
            const typeLabel = getEdgeType(edgeType).label;
            const port: BoundaryPort = {
                id,
                edgeId: edge.id,
                side,
                peerLabel: peer.peerLabel,
                peerNodeId: peer.peerNodeId,
                peerDepth: peer.depth,
                connectionLabel: outerData?.label?.trim() || typeLabel || '',
                edgeType,
                ...(outerData?.color ? {color: outerData.color} : {}),
                bound: index.boundPortIds.has(id),
            };
            (side === 'in' ? inbound : outbound).push(port);
        }
    }
    return [...inbound, ...outbound];
}

/**
 * For each node at `path`, how many of its connections at this level are
 * not wired to anything inside its sub-diagram. Only meaningful for nodes
 * that have a populated sub-diagram - the caller decides that.
 */
export function unwiredPortCounts(
    index: PortIndex,
    path: readonly string[],
): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const edge of index.validEdgesByLevel.get(levelKey(path)) ?? []) {
        if (!isPortId(edge.target) && !index.boundPortIds.has(portId(edge.id, 'in'))) {
            counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
        }
        if (!isPortId(edge.source) && !index.boundPortIds.has(portId(edge.id, 'out'))) {
            counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
        }
    }
    return counts;
}

/**
 * Wires that would be left pointing at a port that no longer exists, in a
 * document made of `nodes` and `edges`. Callers pass the document as it
 * will be AFTER a delete or reconnect, then delete these in the same
 * handler so the whole change is one undo step.
 */
export function findOrphanedPortEdges(
    nodes: readonly AnyNode[],
    edges: readonly AnyEdge[],
): string[] {
    const index = buildPortIndex(nodes, edges);
    return edges.filter((e) => !index.isValidEdge(e.id)).map((e) => e.id);
}

export interface PortConnection {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
}

function pointIdOf(handle: string | null | undefined): string | null {
    if (!handle) return null;
    const dash = handle.indexOf('-');
    return dash === -1 ? handle : handle.slice(dash + 1);
}

/**
 * A connection drawn to or from a port, turned the right way round.
 *
 * Connections always follow the drag (source is where the drag started),
 * but a port's direction is fixed by the edge it stands for: an inbound
 * port can only feed the inside, an outbound one can only be fed. Drawing
 * from an inner node TO an inbound port is the natural gesture for "this
 * node handles that", so it's flipped rather than refused. Returns null
 * for connections that can't be made the right way round either way (two
 * inbound ports, a port to itself).
 */
export function orientPortConnection<T extends PortConnection>(conn: T): T | null {
    const s = parsePortId(conn.source);
    const t = parsePortId(conn.target);
    if (!s && !t) return conn;
    if (conn.source === conn.target) return null;
    const okAsIs = (!s || s.side === 'in') && (!t || t.side === 'out');
    if (okAsIs) return conn;
    const flippedOk = (!t || t.side === 'in') && (!s || s.side === 'out');
    if (!flippedOk) return null;
    const sp = pointIdOf(conn.targetHandle);
    const tp = pointIdOf(conn.sourceHandle);
    return {
        ...conn,
        source: conn.target,
        target: conn.source,
        sourceHandle: sp ? sourceHandleId(sp) : null,
        targetHandle: tp ? targetHandleId(tp) : null,
    };
}

/** True when a port endpoint sits on the end it's allowed on. */
export function isPortOrientationValid(conn: PortConnection): boolean {
    const s = parsePortId(conn.source);
    const t = parsePortId(conn.target);
    return (!s || s.side === 'in') && (!t || t.side === 'out') && conn.source !== conn.target;
}
