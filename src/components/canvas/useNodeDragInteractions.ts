import { type RefObject } from 'react';
import { useCallback, useState } from 'react';
import type { Node, OnNodeDrag } from '@xyflow/react';
import { computeAlignment, type AlignmentGuide } from '../../domain/canvas/alignmentGuides';
import { getDescendantIds, nodeArea, pickInnermostGroup } from '../../domain/canvas/graphUtils';
import type { ArchNodeData } from '../../domain/canvas/types';
import type { CanvasProps, CanvasFlow } from './Canvas';
import { nodeToAlignBox } from './nodeAlignBox';

/**
 * Dragging nodes: live alignment guides, snapping on release, and
 * reparenting into (or out of) boundaries. Moved unchanged from Canvas.tsx.
 *
 * PERFORMANCE: onNodeDrag runs on every pointer move of a drag. It and
 * onNodeDragStop read nodes through nodesRef rather than depending on them,
 * so their identities survive the drag; alignmentGuides is the only state
 * the drag itself updates.
 *
 * Performance contract: runs inside Canvas's render, called at the exact
 * position its code had in Canvas.tsx, so it adds no component, no render,
 * and no change to the order effects run in. Destructure the result and
 * depend on its members - never on the returned object, which is new on
 * every render.
 */
export function useNodeDragInteractions({
  nodesRef,
  onNodesChange,
  getIntersectingNodes,
  onReparentNode,
  onAdoptIntoGroup,
}: Pick<CanvasProps, 'onNodesChange' | 'onReparentNode' | 'onAdoptIntoGroup'> & {
  nodesRef: RefObject<Node<ArchNodeData>[]>;
  getIntersectingNodes: CanvasFlow['getIntersectingNodes'];
}) {
  // Alignment guides (draw.io/Excalidraw-style "smart guides") - visible
  // only while actively dragging a node, cleared as soon as the drag ends.
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);

  const getAlignmentCandidates = useCallback(
    (draggedNode: Node<ArchNodeData>) => {
      // A dragged boundary carries everything inside it at any depth, so
      // none of that is a fixed reference to align against.
      const carried =
        draggedNode.type === 'group'
          ? getDescendantIds(draggedNode.id, nodesRef.current)
          : undefined;
      return nodesRef.current.filter((n) => n.id !== draggedNode.id && !carried?.has(n.id));
    },
    [nodesRef],
  );

  const onNodeDrag = useCallback<OnNodeDrag<Node<ArchNodeData>>>(
    (_event, draggedNode) => {
      const boxes = [draggedNode, ...getAlignmentCandidates(draggedNode)].map((n) =>
        nodeToAlignBox(n, nodesRef.current),
      );
      const movingBox = boxes.find((b) => b.id === draggedNode.id);
      if (!movingBox) return;
      const { guides } = computeAlignment(movingBox, boxes);
      setAlignmentGuides(guides);
    },
    [getAlignmentCandidates, nodesRef],
  );

  // Two symmetric cases here:
  //  - dragging a node so it overlaps a boundary makes it a child of that
  //    boundary (moves with it from then on). Boundaries nest, so when it
  //    overlaps several, the innermost one wins.
  //  - dragging a *boundary* over existing nodes adopts whichever nodes now
  //    fall fully inside it, rather than requiring each one to be dragged in
  //    individually. Full containment (not just a corner clipping) is
  //    required for the boundary-drag case, since you're enclosing them.
  //    Enclosed boundaries are adopted too, but their own children are left
  //    with them (see graphUtils.ts's selectNodesToAdopt).
  // A dragged boundary is itself reparented as well: into the innermost
  // boundary that now fully encloses it, or back to the canvas if none does.
  // See App.tsx's onReparentNode/onAdoptIntoGroup for the position math.
  const onNodeDragStop = useCallback<OnNodeDrag<Node<ArchNodeData>>>(
    (_event, draggedNode) => {
      setAlignmentGuides([]);

      let snapDx = 0;
      let snapDy = 0;
      const boxes = [draggedNode, ...getAlignmentCandidates(draggedNode)].map((n) =>
        nodeToAlignBox(n, nodesRef.current),
      );
      const movingBox = boxes.find((b) => b.id === draggedNode.id);
      if (movingBox) {
        ({ snapDx, snapDy } = computeAlignment(movingBox, boxes));
        if (snapDx !== 0 || snapDy !== 0) {
          onNodesChange([
            {
              id: draggedNode.id,
              type: 'position',
              position: { x: draggedNode.position.x + snapDx, y: draggedNode.position.y + snapDy },
            },
          ]);
        }
      }

      const allNodes = nodesRef.current;
      if (draggedNode.type === 'group') {
        // With partially=false React Flow returns every node that either
        // sits fully inside the dragged boundary or fully encloses it - the
        // smaller of the two in each pair is the one inside.
        const draggedArea = nodeArea(draggedNode);
        const carried = getDescendantIds(draggedNode.id, allNodes);
        const fullyOverlapping = getIntersectingNodes(draggedNode, false).filter(
          (n) => !carried.has(n.id),
        );
        const enclosing = fullyOverlapping.filter(
          (n) => n.type === 'group' && nodeArea(n) > draggedArea,
        );
        const enclosed = fullyOverlapping.filter((n) => nodeArea(n) <= draggedArea);

        const container = pickInnermostGroup(draggedNode.id, enclosing, allNodes);
        if (enclosed.length > 0) {
          onAdoptIntoGroup(
            draggedNode.id,
            enclosed.map((n) => n.id),
            { x: draggedNode.position.x + snapDx, y: draggedNode.position.y + snapDy },
          );
        }
        onReparentNode(draggedNode.id, container ? container.id : null);
        return;
      }
      const intersectingGroup = pickInnermostGroup(
        draggedNode.id,
        getIntersectingNodes(draggedNode),
        allNodes,
      );
      onReparentNode(draggedNode.id, intersectingGroup ? intersectingGroup.id : null);
    },
    [
      getAlignmentCandidates,
      onNodesChange,
      getIntersectingNodes,
      onReparentNode,
      onAdoptIntoGroup,
      nodesRef,
    ],
  );

  return {
    alignmentGuides,
    onNodeDrag,
    onNodeDragStop,
  };
}
