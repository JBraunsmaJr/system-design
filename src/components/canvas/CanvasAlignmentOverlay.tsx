import { ViewportPortal } from '@xyflow/react';
import type { AlignmentGuide } from '../../domain/canvas/alignmentGuides';

export interface CanvasAlignmentOverlayProps {
  alignmentGuides: AlignmentGuide[];
}

export function CanvasAlignmentOverlay({ alignmentGuides }: CanvasAlignmentOverlayProps) {
  if (alignmentGuides.length === 0) return null;

  return (
    <ViewportPortal>
      {alignmentGuides.map((guide, i) => (
        <div
          key={i}
          className="alignment-guide"
          style={
            guide.orientation === 'vertical'
              ? {
                  left: guide.position,
                  top: guide.start,
                  width: 0,
                  height: guide.end - guide.start,
                }
              : {
                  top: guide.position,
                  left: guide.start,
                  width: guide.end - guide.start,
                  height: 0,
                }
          }
        />
      ))}
    </ViewportPortal>
  );
}
