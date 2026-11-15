import {
  type Dispatch,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { NODE_TYPES } from '../../domain/canvas/nodeRegistry';
import { GROUP_TYPES } from '../../domain/canvas/groupRegistry';
import { globalShapeRegistry, SHAPE_TYPES } from '../../domain/canvas/shapeRegistry';
import {
  CODE_DRAG_MIME_TYPE,
  DRAG_MIME_TYPE,
  FRAGMENT_DRAG_MIME_TYPE,
  GROUP_DRAG_MIME_TYPE,
  SHAPE_DRAG_MIME_TYPE,
  TEXT_DRAG_MIME_TYPE,
} from './Palette';
import type { CanvasFlow, CanvasProps } from './Canvas';
import { onPaletteAddRequest } from '../../domain/canvas/paletteAddRequests';

/** How far each item added from the keyboard lands from the one before, so
 * several in a row don't stack exactly on top of each other. */
const KEYBOARD_ADD_STEP = 28;
const KEYBOARD_ADD_STEPS = 6;

const PALETTE_MIME_TYPES = [
  FRAGMENT_DRAG_MIME_TYPE,
  DRAG_MIME_TYPE,
  GROUP_DRAG_MIME_TYPE,
  SHAPE_DRAG_MIME_TYPE,
  CODE_DRAG_MIME_TYPE,
  TEXT_DRAG_MIME_TYPE,
];

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
  onInsertFragment,
  setEditingLabelNodeId,
}: Pick<
  CanvasProps,
  'onAddNode' | 'onAddGroup' | 'onAddShape' | 'onAddCode' | 'onAddText' | 'onInsertFragment'
> & {
  screenToFlowPosition: CanvasFlow['screenToFlowPosition'];
  isPresenting: boolean;
  setEditingLabelNodeId: Dispatch<SetStateAction<string | null>>;
}) {
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  /** Creates what a palette entry stands for at `position`. Returns false
   * for a type or id nothing here recognises. */
  const createFromPalette = useCallback(
    (mimeType: string, id: string, position: { x: number; y: number }): boolean => {
      if (!id) return false;
      switch (mimeType) {
        case FRAGMENT_DRAG_MIME_TYPE:
          // Presenting shows the diagram, it doesn't edit it - a fragment
          // dropped then is swallowed rather than handled as anything else.
          if (!isPresenting) onInsertFragment?.(id, position);
          return true;
        case DRAG_MIME_TYPE:
          if (!NODE_TYPES.some((n) => n.id === id)) return false;
          onAddNode(id, position);
          return true;
        case GROUP_DRAG_MIME_TYPE:
          if (!GROUP_TYPES.some((g) => g.id === id)) return false;
          onAddGroup(id, position);
          return true;
        case SHAPE_DRAG_MIME_TYPE:
          if (!SHAPE_TYPES.some((s) => s.id === id) && !globalShapeRegistry.getShape(id)) {
            return false;
          }
          onAddShape(id, position);
          return true;
        case CODE_DRAG_MIME_TYPE:
          setEditingLabelNodeId(onAddCode(position));
          return true;
        case TEXT_DRAG_MIME_TYPE:
          setEditingLabelNodeId(onAddText(position));
          return true;
        default:
          return false;
      }
    },
    [
      isPresenting,
      onAddNode,
      onAddGroup,
      onAddShape,
      onAddCode,
      onAddText,
      onInsertFragment,
      setEditingLabelNodeId,
    ],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // In this order: the first type the drag carries decides what it is.
      for (const mimeType of PALETTE_MIME_TYPES) {
        const id = event.dataTransfer.getData(mimeType);
        if (id) {
          createFromPalette(mimeType, id, position);
          return;
        }
      }
    },
    [screenToFlowPosition, createFromPalette],
  );

  // Enter on a palette search result: the item goes to the middle of what
  // is on screen, each one a step down and right of the last.
  const keyboardAddCount = useRef(0);
  useEffect(() => {
    if (isPresenting) return;
    return onPaletteAddRequest(({ mimeType, id }) => {
      const rect = document.querySelector('.canvas')?.getBoundingClientRect();
      if (!rect) return;
      const offset = (keyboardAddCount.current % KEYBOARD_ADD_STEPS) * KEYBOARD_ADD_STEP;
      const position = screenToFlowPosition({
        x: rect.left + rect.width / 2 + offset,
        y: rect.top + rect.height / 2 + offset,
      });
      if (createFromPalette(mimeType, id, position)) keyboardAddCount.current += 1;
    });
  }, [isPresenting, screenToFlowPosition, createFromPalette]);

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
