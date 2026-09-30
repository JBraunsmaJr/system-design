import { type Dispatch, type SetStateAction } from 'react';
import { useCallback, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { NODE_TYPES } from '../../domain/canvas/nodeRegistry';
import { GROUP_TYPES } from '../../domain/canvas/groupRegistry';
import { SHAPE_TYPES, globalShapeRegistry } from '../../domain/canvas/shapeRegistry';
import {
  DRAG_MIME_TYPE,
  GROUP_DRAG_MIME_TYPE,
  TEXT_DRAG_MIME_TYPE,
  SHAPE_DRAG_MIME_TYPE,
  CODE_DRAG_MIME_TYPE,
} from './Palette';
import type { CanvasProps, CanvasFlow } from './Canvas';

/**
 * Creating things on the canvas: dropping from the palette, and
 * double-clicking empty canvas for a text annotation. Moved unchanged from
 * Canvas.tsx.
 *
 * Performance contract: runs inside Canvas's render, called at the exact
 * position its code had in Canvas.tsx, so it adds no component, no render,
 * and no change to the order effects run in. Destructure the result and
 * depend on its members - never on the returned object, which is new on
 * every render.
 */
export function useCanvasCreation({
  screenToFlowPosition,
  isPresenting,
  onAddNode,
  onAddGroup,
  onAddShape,
  onAddCode,
  onAddText,
  setEditingLabelNodeId,
}: Pick<CanvasProps, 'onAddNode' | 'onAddGroup' | 'onAddShape' | 'onAddCode' | 'onAddText'> & {
  screenToFlowPosition: CanvasFlow['screenToFlowPosition'];
  isPresenting: boolean;
  setEditingLabelNodeId: Dispatch<SetStateAction<string | null>>;
}) {
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      const nodeTypeId = event.dataTransfer.getData(DRAG_MIME_TYPE);
      if (nodeTypeId && NODE_TYPES.some((n) => n.id === nodeTypeId)) {
        onAddNode(nodeTypeId, position);
        return;
      }

      const groupTypeId = event.dataTransfer.getData(GROUP_DRAG_MIME_TYPE);
      if (groupTypeId && GROUP_TYPES.some((g) => g.id === groupTypeId)) {
        onAddGroup(groupTypeId, position);
        return;
      }

      const shapeTypeId = event.dataTransfer.getData(SHAPE_DRAG_MIME_TYPE);
      if (
        shapeTypeId &&
        (SHAPE_TYPES.some((s) => s.id === shapeTypeId) || globalShapeRegistry.getShape(shapeTypeId))
      ) {
        onAddShape(shapeTypeId, position);
        return;
      }

      if (event.dataTransfer.getData(CODE_DRAG_MIME_TYPE)) {
        setEditingLabelNodeId(onAddCode(position));
        return;
      }

      if (event.dataTransfer.getData(TEXT_DRAG_MIME_TYPE)) {
        setEditingLabelNodeId(onAddText(position));
      }
    },
    [
      screenToFlowPosition,
      onAddNode,
      onAddGroup,
      onAddShape,
      onAddCode,
      onAddText,
      setEditingLabelNodeId,
    ],
  );

  // Double-clicking truly empty canvas creates a text annotation right
  // there and drops straight into editing it - checking that the event
  // target is the pane element itself (not bubbled from a node, edge, or
  // overlay control) is what keeps this from firing on top of, say,
  // double-clicking a node to drill into it.
  const onCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isPresenting) return;
      const target = event.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setEditingLabelNodeId(onAddText(position));
    },
    [isPresenting, screenToFlowPosition, onAddText, setEditingLabelNodeId],
  );

  return {
    onDragOver,
    onDrop,
    onCanvasDoubleClick,
  };
}
