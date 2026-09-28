import { SendToBack, BringToFront, ChevronUp, ChevronDown } from 'lucide-react';
import type { ZOrderCommand } from '../../../domain/canvas/zOrder';

export interface ZOrderControlsProps {
  onCommand: (command: ZOrderCommand) => void;
}

/**
 * Front/back controls for the current selection.
 *
 * Shown for every node type because any node can end up buried - the
 * reported case was a rectangle covering nodes, but a large node can
 * just as easily cover a small one. The commands themselves live in
 * App.tsx, since deciding what "in front" means needs every node's
 * geometry and the Inspector only sees the selected one.
 */
export function ZOrderControls({ onCommand }: ZOrderControlsProps) {
  return (
    <div className="inspector__z-order">
      <span className="inspector__z-order-label">Arrange</span>
      <div className="inspector__z-order-buttons">
        <button type="button" onClick={() => onCommand('back')} title="Send to back">
          <SendToBack size={13} />
        </button>
        <button type="button" onClick={() => onCommand('backward')} title="Send backward">
          <ChevronDown size={13} />
        </button>
        <button type="button" onClick={() => onCommand('forward')} title="Bring forward">
          <ChevronUp size={13} />
        </button>
        <button type="button" onClick={() => onCommand('front')} title="Bring to front">
          <BringToFront size={13} />
        </button>
      </div>
    </div>
  );
}
