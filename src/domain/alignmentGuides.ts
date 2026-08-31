export interface AlignBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlignmentGuide {
  orientation: "vertical" | "horizontal";
  /** The X (vertical guide) or Y (horizontal guide) position of the line, in flow coordinates. */
  position: number;
  /** The line only needs to span the two aligned boxes, not the whole canvas. */
  start: number;
  end: number;
}

/** How close (in flow px) an edge/center needs to be to another box's
 * corresponding edge/center before it's considered "aligned". Kept
 * generous enough to be easy to hit, tight enough not to fire constantly. */
export const ALIGNMENT_THRESHOLD = 6;

function edgesX(box: AlignBox) {
  return { left: box.x, centerX: box.x + box.width / 2, right: box.x + box.width };
}
function edgesY(box: AlignBox) {
  return { top: box.y, centerY: box.y + box.height / 2, bottom: box.y + box.height };
}

/**
 * Compares `moving` against every box in `candidates` (typically its
 * siblings - same parent, so they share one coordinate space) and finds the
 * closest X and Y alignment independently. Returns the guide lines to draw
 * and, if within ALIGNMENT_THRESHOLD, the delta that would snap `moving`
 * exactly onto that alignment.
 *
 * X and Y are resolved independently - a single call can suggest a snap on
 * both axes at once (e.g. matching one box's left edge while also matching
 * a different box's vertical center), matching how draw.io/Excalidraw's
 * guides behave.
 */
export function computeAlignment(
  moving: AlignBox,
  candidates: AlignBox[]
): { guides: AlignmentGuide[]; snapDx: number; snapDy: number } {
  const mX = edgesX(moving);
  const mY = edgesY(moving);

  let bestX: { delta: number; guide: AlignmentGuide } | null = null;
  let bestY: { delta: number; guide: AlignmentGuide } | null = null;

  for (const other of candidates) {
    if (other.id === moving.id) continue;
    const oX = edgesX(other);
    const oY = edgesY(other);

    for (const mv of [mX.left, mX.centerX, mX.right]) {
      for (const ov of [oX.left, oX.centerX, oX.right]) {
        const delta = ov - mv;
        if (Math.abs(delta) <= ALIGNMENT_THRESHOLD && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          const top = Math.min(moving.y, other.y);
          const bottom = Math.max(moving.y + moving.height, other.y + other.height);
          bestX = { delta, guide: { orientation: "vertical", position: ov, start: top, end: bottom } };
        }
      }
    }

    for (const mv of [mY.top, mY.centerY, mY.bottom]) {
      for (const ov of [oY.top, oY.centerY, oY.bottom]) {
        const delta = ov - mv;
        if (Math.abs(delta) <= ALIGNMENT_THRESHOLD && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          const left = Math.min(moving.x, other.x);
          const right = Math.max(moving.x + moving.width, other.x + other.width);
          bestY = { delta, guide: { orientation: "horizontal", position: ov, start: left, end: right } };
        }
      }
    }
  }

  const guides: AlignmentGuide[] = [];
  if (bestX) guides.push(bestX.guide);
  if (bestY) guides.push(bestY.guide);

  return { guides, snapDx: bestX?.delta ?? 0, snapDy: bestY?.delta ?? 0 };
}
