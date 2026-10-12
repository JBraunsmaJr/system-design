import type {Node} from '@xyflow/react';
import {getAncestorIds, toAbsolutePosition, toRelativePosition} from './graphUtils';
import type {ArchNodeData} from './types';

/** Space left around the grouped nodes inside the new boundary. The top
 * gets more, because that's where GroupNode draws its label chip. */
export const GROUP_PADDING = 24;
export const GROUP_HEADER_PADDING = 48;
/** GroupNode's own NodeResizer minimums - a boundary created smaller would
 * snap to these the first time someone touched a handle. */
export const GROUP_MIN_WIDTH = 220;
export const GROUP_MIN_HEIGHT = 140;
/** Stand-in size for a node React Flow hasn't measured yet. */
const UNMEASURED_WIDTH = 160;
const UNMEASURED_HEIGHT = 60;

export interface GroupPlan {
    /** The boundary the new group goes inside, if any - the nearest one that
     * already contains every member. */
    parentId: string | undefined;
    /** Relative to parentId, like every node position. */
    position: { x: number; y: number };
    width: number;
    height: number;
    /** The nodes that become the group's direct children, each with its new
     * position relative to the group. */
    members: { id: string; position: { x: number; y: number } }[];
}

/**
 * What wrapping `targetIds` in a new boundary would create.
 *
 * Only the OUTERMOST targets become members: a selected node inside a
 * selected boundary travels with that boundary rather than being pulled
 * out of it. The new boundary sits inside the nearest boundary that
 * already contains all of them, so grouping two nodes inside a VPC keeps
 * them in the VPC. Returns null when there's nothing to group.
 *
 * Pure geometry - the caller writes it, in one transaction.
 */
export function planGroup(targetIds: string[], nodes: Node<ArchNodeData>[]): GroupPlan | null {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const targets = [...new Set(targetIds)]
        .map((id) => byId.get(id))
        .filter((n): n is Node<ArchNodeData> => !!n && n.type !== 'port');
    if (targets.length === 0) return null;
    const targetSet = new Set(targets.map((n) => n.id));
    const outermost = targets.filter((n) =>
        getAncestorIds(n.id, nodes).every((ancestor) => !targetSet.has(ancestor)),
    );

    // Nearest common ancestor: the first of the first member's ancestors that
    // every other member also sits inside.
    const ancestorLists = outermost.map((n) => getAncestorIds(n.id, nodes));
    const parentId = ancestorLists[0].find((candidate) =>
        ancestorLists.every((list) => list.includes(candidate)),
    );

    const boxes = outermost.map((n) => {
        // Same width/height fallback as nodeToAlignBox: a content-sized node
        // carries only a measured size, never an explicit one.
        const at = toAbsolutePosition(n, nodes, n.parentId);
        return {
            id: n.id,
            x: at.x,
            y: at.y,
            width: n.width ?? n.measured?.width ?? UNMEASURED_WIDTH,
            height: n.height ?? n.measured?.height ?? UNMEASURED_HEIGHT,
        };
    });
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.width));
    const maxY = Math.max(...boxes.map((b) => b.y + b.height));

    const absolute = {x: minX - GROUP_PADDING, y: minY - GROUP_HEADER_PADDING};
    const width = Math.max(GROUP_MIN_WIDTH, maxX - minX + GROUP_PADDING * 2);
    const height = Math.max(GROUP_MIN_HEIGHT, maxY - minY + GROUP_PADDING + GROUP_HEADER_PADDING);

    return {
        parentId,
        position: toRelativePosition(absolute, nodes, parentId),
        width,
        height,
        members: boxes.map((b) => ({
            id: b.id,
            position: {x: b.x - absolute.x, y: b.y - absolute.y},
        })),
    };
}
