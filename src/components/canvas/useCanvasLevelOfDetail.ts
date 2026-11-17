import { type RefObject, useEffect } from 'react';
import { useOnViewportChange, useReactFlow } from '@xyflow/react';
import { applyLod, lodForZoom } from '../../domain/canvas/levelOfDetail';

/**
 * Keeps the canvas element's level of detail in step with the zoom - see
 * levelOfDetail.ts.
 *
 * PERFORMANCE: this writes two values straight onto the element and holds
 * no state, so a zoom re-renders nothing: not Canvas, not a single node.
 * Subscribing to the zoom with useStore/useViewport here would re-render
 * Canvas on every frame of a pan or zoom.
 */
export function useCanvasLevelOfDetail(
  canvasRef: RefObject<HTMLElement | null>,
  /** Presenting always shows full detail: the view is framed on purpose. */
  disabled: boolean,
) {
  const { getViewport } = useReactFlow();

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    applyLod(element, disabled ? { lod: 'detail', scale: 1 } : lodForZoom(getViewport().zoom));
  }, [canvasRef, disabled, getViewport]);

  useOnViewportChange({
    onChange: ({ zoom }) => {
      const element = canvasRef.current;
      if (element && !disabled) applyLod(element, lodForZoom(zoom));
    },
  });
}
