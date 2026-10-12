import type {Node} from '@xyflow/react';
import {getAncestorIds, toAbsolutePosition, toRelativePosition} from './graphUtils';
import {isAutoSizedNodeType} from './nodeChangeBatching';
import type {ArchNodeData} from './types';

/**
 * Align, distribute and match size for a multi-selection - the deliberate
 * counterpart to the alignment guides shown while dragging.
 *
 * Pure geometry: planArrange works out where everything goes, and the caller
 * writes it in one transaction. Everything is computed in absolute canvas
 * coordinates, so nodes inside different boundaries line up on screen, and
 * converted back to each node's own parent-relative position at the end.
 */

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';
export type MatchDimension = 'width' | 'height' | 'both';

export type ArrangeCommand =
    | { kind: 'align'; edge: AlignEdge }
    | { kind: 'distribute'; axis: DistributeAxis }
    | { kind: 'matchSize'; dimension: MatchDimension };

export interface ArrangeBox {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ArrangePlan {
    /** New positions, relative to each node's own parent. */
    positions: Map<string, { x: number; y: number }>;
    /** New explicit sizes. */
    sizes: Map<string, { width: number; height: number }>;
}

/** Stand-in size for a node React Flow hasn't measured yet. */
const UNMEASURED_WIDTH = 160;
const UNMEASURED_HEIGHT = 60;

/** Diagrams end up in the SRD; whole pixels keep edges crisp there. */
const round = (v: number) => Math.round(v);

/**
 * Moves every movable box so the chosen edge or center lines up with the
 * same edge or center of the selection's bounding box - which is where
 * Figma, Keynote and draw.io all align to. `fixed` boxes (locked nodes)
 * still count towards that bounding box, so a locked node works as the
 * anchor everything else lines up with.
 */
export function alignBoxes(
    boxes: readonly ArrangeBox[],
    edge: AlignEdge,
    fixed: ReadonlySet<string> = new Set(),
): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    if (boxes.length < 2) return out;
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const top = Math.min(...boxes.map((b) => b.y));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    for (const b of boxes) {
        if (fixed.has(b.id)) continue;
        let {x, y} = b;
        switch (edge) {
            case 'left':
                x = left;
                break;
            case 'center':
                x = (left + right) / 2 - b.width / 2;
                break;
            case 'right':
                x = right - b.width;
                break;
            case 'top':
                y = top;
                break;
            case 'middle':
                y = (top + bottom) / 2 - b.height / 2;
                break;
            case 'bottom':
                y = bottom - b.height;
                break;
        }
        if (round(x) !== b.x || round(y) !== b.y) out.set(b.id, {x: round(x), y: round(y)});
    }
    return out;
}

/**
 * Equal gaps between neighbours along one axis. The two outermost boxes
 * stay where they are and everything between is spaced evenly between
 * them, in the order the boxes already sit in - the standard "distribute
 * spacing". Needs at least three boxes to do anything.
 */
export function distributeBoxes(
    boxes: readonly ArrangeBox[],
    axis: DistributeAxis,
): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    if (boxes.length < 3) return out;
    const horizontal = axis === 'horizontal';
    const start = (b: ArrangeBox) => (horizontal ? b.x : b.y);
    const size = (b: ArrangeBox) => (horizontal ? b.width : b.height);
    // By center, so a wide box that starts early but ends late keeps its place.
    const sorted = [...boxes].sort(
        (a, b) => start(a) + size(a) / 2 - (start(b) + size(b) / 2) || a.id.localeCompare(b.id),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = start(last) + size(last) - start(first);
    const occupied = sorted.reduce((sum, b) => sum + size(b), 0);
    const gap = (span - occupied) / (sorted.length - 1);
    let cursor = start(first) + size(first) + gap;
    for (const b of sorted.slice(1, -1)) {
        const next = round(cursor);
        if (next !== start(b)) out.set(b.id, horizontal ? {x: next, y: b.y} : {x: b.x, y: next});
        cursor += size(b) + gap;
    }
    return out;
}

/**
 * Resizes every resizable box to the largest width and/or height in the
 * selection. The largest, rather than the first-selected, because selection
 * order isn't visible anywhere - and growing is the safer direction, since
 * shrinking can clip a box's content.
 */
export function matchBoxSizes(
    boxes: readonly ArrangeBox[],
    dimension: MatchDimension,
    resizable: ReadonlySet<string>,
): Map<string, { width: number; height: number }> {
    const out = new Map<string, { width: number; height: number }>();
    if (boxes.length < 2) return out;
    const width = Math.max(...boxes.map((b) => b.width));
    const height = Math.max(...boxes.map((b) => b.height));
    for (const b of boxes) {
        if (!resizable.has(b.id)) continue;
        const next = {
            width: round(dimension === 'height' ? b.width : width),
            height: round(dimension === 'width' ? b.height : height),
        };
        if (next.width !== b.width || next.height !== b.height) out.set(b.id, next);
    }
    return out;
}

/** Whether a node's size can be set explicitly. Typed nodes size to their
 * content (see isAutoSizedNodeType), so matching sizes skips them - though
 * they still count as the size to match. */
export function isResizableNode(node: Node<ArchNodeData>): boolean {
    return !isAutoSizedNodeType(node.type) && node.type !== 'port';
}

/**
 * Which of `targetIds` an arrange command acts on: the outermost ones - a
 * node inside a selected boundary moves with that boundary, not on its own -
 * and never boundary ports.
 */
export function arrangeTargets(
    targetIds: readonly string[],
    nodes: readonly Node<ArchNodeData>[],
): Node<ArchNodeData>[] {
    const ids = new Set(targetIds);
    const all = nodes as Node<ArchNodeData>[];
    return all.filter(
        (n) =>
            ids.has(n.id) &&
            n.type !== 'port' &&
            getAncestorIds(n.id, all).every((ancestor) => !ids.has(ancestor)),
    );
}

/** What each command needs to do anything at all - for disabling buttons. */
export function canArrange(
    command: ArrangeCommand,
    targetIds: readonly string[],
    nodes: readonly Node<ArchNodeData>[],
): boolean {
    const targets = arrangeTargets(targetIds, nodes);
    if (command.kind === 'distribute') return targets.filter((n) => !n.data.locked).length >= 3;
    if (command.kind === 'matchSize')
        return targets.length >= 2 && targets.some((n) => isResizableNode(n) && !n.data.locked);
    return targets.length >= 2 && targets.some((n) => !n.data.locked);
}

/**
 * The positions and sizes `command` gives the selected nodes. Locked nodes
 * never move or resize, but still serve as the reference for aligning and
 * matching; distributing leaves them out entirely, since a fixed box in the
 * middle of a row can't be spaced evenly around.
 */
export function planArrange(
    command: ArrangeCommand,
    targetIds: readonly string[],
    nodes: readonly Node<ArchNodeData>[],
): ArrangePlan {
    const all = nodes as Node<ArchNodeData>[];
    const targets = arrangeTargets(targetIds, nodes);
    const byId = new Map(targets.map((n) => [n.id, n]));
    const boxOf = (n: Node<ArchNodeData>): ArrangeBox => {
        const at = toAbsolutePosition(n, all, n.parentId);
        return {
            id: n.id,
            x: at.x,
            y: at.y,
            width: n.width ?? n.measured?.width ?? UNMEASURED_WIDTH,
            height: n.height ?? n.measured?.height ?? UNMEASURED_HEIGHT,
        };
    };
    const locked = new Set(targets.filter((n) => n.data.locked).map((n) => n.id));

    let absolute = new Map<string, { x: number; y: number }>();
    let sizes = new Map<string, { width: number; height: number }>();
    if (command.kind === 'align') {
        absolute = alignBoxes(targets.map(boxOf), command.edge, locked);
    } else if (command.kind === 'distribute') {
        absolute = distributeBoxes(targets.filter((n) => !locked.has(n.id)).map(boxOf), command.axis);
    } else {
        const resizable = new Set(
            targets.filter((n) => isResizableNode(n) && !locked.has(n.id)).map((n) => n.id),
        );
        sizes = matchBoxSizes(targets.map(boxOf), command.dimension, resizable);
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, at] of absolute) {
        const node = byId.get(id)!;
        positions.set(id, toRelativePosition(at, all, node.parentId));
    }
    return {positions, sizes};
}
