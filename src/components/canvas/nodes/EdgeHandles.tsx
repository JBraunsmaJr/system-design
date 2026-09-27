import { Handle, Position } from '@xyflow/react';
import type { ConnectionPoint } from '../../../domain/canvas/shapeRegistry';
import { SIDES, grabHandleId, sourceHandleId, targetHandleId } from '../../../domain/canvas/edgeAnchoring';

const SIDE_TO_POSITION = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
} as const;

function positionForPoint(pt: ConnectionPoint): Position {
  if (pt.direction === 'right') return Position.Right;
  if (pt.direction === 'bottom') return Position.Bottom;
  if (pt.direction === 'left') return Position.Left;
  if (pt.direction === 'top') return Position.Top;
  if (pt.x > 0.75) return Position.Right;
  if (pt.x < 0.25) return Position.Left;
  if (pt.y > 0.75) return Position.Bottom;
  return Position.Top;
}

interface EdgeHandlesProps {
  /**
   * Custom attachment points (ShapeNode's shape definitions). Omit for the
   * standard one-per-side set every other node uses.
   */
  points?: readonly ConnectionPoint[];
}

/**
 * Connection handles without any visible connector dots. Two layers:
 *
 * ANCHORS - the invisible `target-<id>` / `source-<id>` handle pairs edges
 * actually attach to. Same ids, positions and size as the old visible
 * dots, so every existing edge renders exactly where it did before. They
 * can't be grabbed (pointer-events: none) and aren't drop targets on their
 * own - React Flow still measures them, which is all an edge needs.
 *
 * GRAB STRIPS - one invisible `grab-<side>` handle running the full length
 * of each side, straddling the border. Pressing on a node's border and
 * dragging starts a connection from here. They only ever START a drag
 * (isConnectableEnd=false): where the drag ends up is resolved
 * geometrically in Canvas.tsx (see domain/edgeAnchoring.ts), so a release
 * can land on a border OR anywhere over a node's body.
 *
 * Anchors are rendered first so React Flow's "no handle id → first handle"
 * fallback for legacy edges still lands on `source-top`/`target-top`.
 */
export function EdgeHandles({ points }: EdgeHandlesProps) {
  const anchors =
    points && points.length > 0
      ? points.map((pt) => ({
          id: pt.id,
          position: positionForPoint(pt),
          style: { left: `${pt.x * 100}%`, top: `${pt.y * 100}%` },
        }))
      : SIDES.map((side) => ({ id: side, position: SIDE_TO_POSITION[side], style: undefined }));

  return (
    <>
      {anchors.map((a) => (
        <Handle
          key={`target-${a.id}`}
          id={targetHandleId(a.id)}
          type="target"
          position={a.position}
          style={a.style}
          className="edge-anchor"
          isConnectableStart={false}
          isConnectableEnd={false}
        />
      ))}
      {anchors.map((a) => (
        <Handle
          key={`source-${a.id}`}
          id={sourceHandleId(a.id)}
          type="source"
          position={a.position}
          style={a.style}
          className="edge-anchor"
          isConnectableStart={false}
          isConnectableEnd={false}
        />
      ))}
      {SIDES.map((side) => (
        <Handle
          key={grabHandleId(side)}
          id={grabHandleId(side)}
          type="source"
          position={SIDE_TO_POSITION[side]}
          className={`edge-grab edge-grab--${side}`}
          isConnectableEnd={false}
        />
      ))}
    </>
  );
}
