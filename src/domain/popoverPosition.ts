export interface AnchorRect {
  top: number;
  bottom: number;
  right: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Computes where a fixed-position popover should render relative to an
 * anchor (a trigger button's rect, or a text caret's line), right-aligned
 * with the anchor's right edge and clamped so it never renders past either
 * horizontal edge of the viewport.
 *
 * Vertically, prefers opening below the anchor (the expected default
 * direction), but flips to open above when there isn't enough room below
 * AND there's more room above than below - matching how most dropdown/
 * autocomplete UI behaves. If neither direction has enough room, it stays
 * below rather than flipping into a position that's equally or more
 * cramped; the flipped-above position is itself clamped so it can never
 * render above the viewport's own top edge either.
 */
export function computeFlippedPosition(
  anchor: AnchorRect,
  popoverSize: PopoverSize,
  viewport: Viewport,
  gap = 4
): { top: number; left: number } {
  const left = Math.max(8, Math.min(anchor.right - popoverSize.width, viewport.width - popoverSize.width - 8));

  const spaceBelow = viewport.height - anchor.bottom;
  const spaceAbove = anchor.top;

  if (spaceBelow >= popoverSize.height + gap || spaceBelow >= spaceAbove) {
    return { top: anchor.bottom + gap, left };
  }
  return { top: Math.max(8, anchor.top - popoverSize.height - gap), left };
}
