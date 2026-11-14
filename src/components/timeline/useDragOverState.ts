import { useEffect, useRef, useState } from 'react';

/**
 * Whether something is being dragged over a drop target.
 *
 * `dragenter` and `dragleave` fire for every child element the pointer
 * crosses, so a plain boolean flickers off whenever the pointer moves from
 * the target onto a card inside it. Counting enters against leaves tracks
 * the target as a whole.
 *
 * The count can be left non-zero when a drag ends somewhere that delivers no
 * `dragleave` here (a drop on another target, Escape, leaving the window),
 * so both the count and the flag are cleared when `draggedItemId` returns to
 * null. The flag is cleared during render - React re-renders before
 * painting - rather than in an effect, which would paint one frame of stale
 * highlight and is what react-hooks/set-state-in-effect warns about. The
 * count is a ref, which may only be written outside render, so it keeps its
 * effect.
 *
 * Shared by SprintBoardColumn and BacklogPanel, which used to carry a copy
 * each.
 */
export function useDragOverState(draggedItemId: string | null) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counter = useRef(0);

  const [previousDraggedItemId, setPreviousDraggedItemId] = useState(draggedItemId);
  if (previousDraggedItemId !== draggedItemId) {
    setPreviousDraggedItemId(draggedItemId);
    if (!draggedItemId && isDragOver) setIsDragOver(false);
  }
  useEffect(() => {
    if (!draggedItemId) counter.current = 0;
  }, [draggedItemId]);

  const enter = () => {
    counter.current += 1;
    setIsDragOver(true);
  };
  const leave = () => {
    counter.current -= 1;
    if (counter.current <= 0) {
      counter.current = 0;
      setIsDragOver(false);
    }
  };
  /** After a drop: nothing is over the target any more. */
  const reset = () => {
    counter.current = 0;
    setIsDragOver(false);
  };

  return { isDragOver, enter, leave, reset };
}
