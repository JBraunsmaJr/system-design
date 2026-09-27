import type { Handle, InternalNode, Node } from '@xyflow/react';
import {
  pickAnchor,
  resolveDropTarget,
  sideFromGrabHandleId,
  SIDES,
  type Anchor,
  type DropCandidate,
  type DropTarget,
  type Point,
  type Rect,
  type Side,
} from '../../../domain/canvas/edgeAnchoring';

/**
 * Glue between React Flow's internal node geometry and the pure
 * resolution rules in domain/edgeAnchoring.ts. Shared by Canvas.tsx
 * (which commits the edge on release) and EdgeConnectionLine.tsx (which
 * previews the same result while dragging), so the preview can never
 * disagree with what actually gets created.
 */

/** Screen pixels either side of a border that still count as "on" it.
 * Matches the widest grab strip (a boundary's 8px outer band). */
export const BORDER_TOLERANCE_PX = 8;

type AnyInternalNode = InternalNode<Node>;

function asSide(position: string): Side | null {
  return (SIDES as readonly string[]).includes(position) ? (position as Side) : null;
}

export function nodeRect(node: AnyInternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured?.width ?? node.width ?? 0,
    height: node.measured?.height ?? node.height ?? 0,
  };
}

/**
 * Where an edge drawn to/from this handle actually starts - the same
 * point React Flow uses for a rendered edge (the handle box's outer edge
 * on its side, not its centre), so the preview line meets the node
 * exactly where the finished edge will.
 */
export function handleAttachPoint(node: AnyInternalNode, handle: Handle): Point {
  const x = node.internals.positionAbsolute.x + (handle.x ?? 0);
  const y = node.internals.positionAbsolute.y + (handle.y ?? 0);
  const { width, height } = handle;
  switch (handle.position) {
    case 'top':
      return { x: x + width / 2, y };
    case 'right':
      return { x: x + width, y: y + height / 2 };
    case 'bottom':
      return { x: x + width / 2, y: y + height };
    case 'left':
    default:
      return { x, y: y + height / 2 };
  }
}

export interface ResolvedAnchor extends Anchor {
  attach: Point;
}

/** A node's attachment points, read from its measured `target-*` handles
 * (every anchor has a source/target pair at the same spot, so either set
 * would do). The `grab-*` strips are source-type only and never listed. */
export function nodeAnchors(node: AnyInternalNode): ResolvedAnchor[] {
  const handles = node.internals.handleBounds?.target ?? [];
  const anchors: ResolvedAnchor[] = [];
  for (const handle of handles) {
    if (!handle.id || !handle.id.startsWith('target-')) continue;
    const side = asSide(handle.position);
    if (!side) continue;
    const abs = {
      x: node.internals.positionAbsolute.x + handle.x + handle.width / 2,
      y: node.internals.positionAbsolute.y + handle.y + handle.height / 2,
    };
    anchors.push({
      pointId: handle.id.slice('target-'.length),
      side,
      x: abs.x,
      y: abs.y,
      attach: handleAttachPoint(node, handle),
    });
  }
  return anchors;
}

export function collectDropCandidates(nodeLookup: Map<string, AnyInternalNode>): DropCandidate[] {
  const candidates: DropCandidate[] = [];
  for (const node of nodeLookup.values()) {
    if (node.hidden) continue;
    const anchors = nodeAnchors(node);
    if (anchors.length === 0) continue;
    candidates.push({ id: node.id, rect: nodeRect(node), isGroup: node.type === 'group', anchors });
  }
  return candidates;
}

export interface ConnectionDragResolution {
  /** Set for a NEW connection: the anchor on the node the drag started
   * from. Null for a reconnection, whose anchored end doesn't move. */
  sourceAnchor: ResolvedAnchor | null;
  /** Where the drag would attach if released now, or null to cancel. */
  target: (DropTarget & { anchor: ResolvedAnchor; rect: Rect }) | null;
}

/**
 * Resolve an in-progress drag at `pointer` (flow coordinates).
 *
 * `fromHandle` tells the two gestures apart: a new connection starts from
 * a `grab-<side>` strip, while a reconnection's fromHandle is the edge's
 * anchored (not moving) end, which is always a real anchor.
 */
export function resolveConnectionDrag(args: {
  nodeLookup: Map<string, AnyInternalNode>;
  zoom: number;
  fromNode: AnyInternalNode;
  fromHandle: Handle;
  pointer: Point;
}): ConnectionDragResolution {
  const { nodeLookup, zoom, fromNode, fromHandle, pointer } = args;

  const grabSide = sideFromGrabHandleId(fromHandle.id);
  const anchoredSide = grabSide ?? asSide(fromHandle.position);
  const sourceAnchor = grabSide
    ? ((pickAnchor(nodeAnchors(fromNode), grabSide, pointer) as ResolvedAnchor | null) ?? null)
    : null;

  const candidates = collectDropCandidates(nodeLookup);
  const target = resolveDropTarget(pointer, candidates, {
    borderTolerance: BORDER_TOLERANCE_PX / (zoom || 1),
    anchoredNodeId: fromNode.id,
    anchoredSide,
  });
  if (!target) return { sourceAnchor, target: null };

  const rect = candidates.find((c) => c.id === target.nodeId)!.rect;
  return { sourceAnchor, target: { ...target, anchor: target.anchor as ResolvedAnchor, rect } };
}
