import type { Node } from '@xyflow/react';
import type { AlignBox } from '../../domain/canvas/alignmentGuides';
import { toAbsolutePosition } from '../../domain/canvas/graphUtils';
import type { ArchNodeData } from '../../domain/canvas/types';

/**
 * A node's box in absolute flow coordinates, as alignment guides and peer
 * selection outlines need it. Moved unchanged from Canvas.tsx.
 */
export function nodeToAlignBox(n: Node<ArchNodeData>, allNodes: Node<ArchNodeData>[]): AlignBox {
  const absolute = toAbsolutePosition(n, allNodes, n.parentId);
  return {
    id: n.id,
    x: absolute.x,
    y: absolute.y,
    width: n.width ?? n.measured?.width ?? 0,
    height: n.height ?? n.measured?.height ?? 0,
  };
}
