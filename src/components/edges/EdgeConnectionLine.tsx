import {
  getBezierPath,
  Position,
  useStoreApi,
  type ConnectionLineComponentProps,
} from '@xyflow/react';
import type { Rect, Side } from '../../domain/edgeAnchoring';
import { handleAttachPoint, resolveConnectionDrag } from './edgeAnchoringAdapter';

const OPPOSITE: Record<Side, Position> = {
  top: Position.Bottom,
  bottom: Position.Top,
  left: Position.Right,
  right: Position.Left,
};

/** Inset from each corner so the highlight reads as "this side" rather
 * than colliding with the neighbouring side's highlight at the corner. */
const PREVIEW_INSET = 6;

function sidePreviewPath(rect: Rect, side: Side): string {
  const l = rect.x;
  const r = rect.x + rect.width;
  const t = rect.y;
  const b = rect.y + rect.height;
  const ix = Math.min(PREVIEW_INSET, rect.width / 4);
  const iy = Math.min(PREVIEW_INSET, rect.height / 4);
  switch (side) {
    case 'top':
      return `M ${l + ix} ${t} L ${r - ix} ${t}`;
    case 'bottom':
      return `M ${l + ix} ${b} L ${r - ix} ${b}`;
    case 'left':
      return `M ${l} ${t + iy} L ${l} ${b - iy}`;
    case 'right':
      return `M ${r} ${t + iy} L ${r} ${b - iy}`;
  }
}

/**
 * The in-progress connection line, for both new connections and endpoint
 * reconnection. React Flow's default line starts at the centre of the
 * handle that was grabbed and ends at the pointer; here it starts at the
 * anchor the edge will really use and snaps to the side it will really
 * attach to, with that side highlighted - using the exact same
 * resolution Canvas.tsx commits on release.
 */
export function EdgeConnectionLine({
  fromNode,
  fromHandle,
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  connectionLineStyle,
}: ConnectionLineComponentProps) {
  const store = useStoreApi();
  const { nodeLookup, transform } = store.getState();

  // toX/toY is the pointer in flow coordinates: nothing in this app is a
  // valid React Flow drop handle (see EdgeHandles.tsx), so React Flow never
  // snaps it anywhere itself.
  const pointer = { x: toX, y: toY };
  const { sourceAnchor, target } = resolveConnectionDrag({
    nodeLookup,
    zoom: transform[2],
    fromNode,
    fromHandle,
    pointer,
  });

  let from = { x: fromX, y: fromY };
  let sourcePosition = fromPosition;
  if (sourceAnchor) {
    from = sourceAnchor.attach;
    sourcePosition = sourceAnchor.side as Position;
  } else if (fromHandle.id && !fromHandle.id.startsWith('grab-')) {
    from = handleAttachPoint(fromNode, fromHandle);
  }

  const to = target ? target.anchor.attach : pointer;
  const targetPosition = target ? (target.side as Position) : OPPOSITE[sourcePosition as Side];

  const [path] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition,
    targetX: to.x,
    targetY: to.y,
    targetPosition,
  });

  return (
    <g>
      {target && (
        <path className="edge-drop-preview" d={sidePreviewPath(target.rect, target.side)} />
      )}
      <path
        className="react-flow__connection-path"
        d={path}
        fill="none"
        style={connectionLineStyle}
      />
    </g>
  );
}
