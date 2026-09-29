import { useMemo } from 'react';
import type { CanvasProps, FocusSet } from './Canvas';

/**
 * Which nodes and edges are in focus: a presentation step, a scenario step
 * being previewed, or a single node being jumped to. Moved unchanged from
 * Canvas.tsx.
 *
 * Performance contract: runs inside Canvas's render, called at the exact
 * position its code had in Canvas.tsx, so it adds no component, no render,
 * and no change to the order effects run in. Destructure the result and
 * depend on its members - never on the returned object, which is new on
 * every render.
 */
export function useCanvasFocusSets({
  presentation,
  previewFocus,
  focusNodeId,
}: Pick<CanvasProps, 'presentation' | 'previewFocus' | 'focusNodeId'>) {
  // Full presentation always wins over a step preview if somehow both were
  // active; in practice previewFocus is only ever set while NOT presenting
  // (see App.tsx), so this is mostly a defensive fallback.
  const presentationFocus: FocusSet | null = useMemo(
    () =>
      presentation
        ? { nodeIds: presentation.step.focusNodeIds, edgeIds: presentation.step.focusEdgeIds }
        : null,
    [presentation],
  );
  /**
   * Deliberately kept separate from presentationFocus, not merged into one
   * "activeFocus" - the two need different visual treatments. Full
   * Presentation Mode dims everything else for audience-facing drama; the
   * Scenario panel's step-editing preview instead just highlights members
   * while leaving everything ELSE at full visibility/opacity, since while
   * you're actively adding/removing things from a step you need to clearly see
   * (and click) the candidates, not have them all dimmed into near invisibility.
   * Camera auto-framing (below) still treats both the same, since "zoom to
   * what's focused" is equally useful for either
   */
  /** A single-node focus for "jump to this node" navigation (see
   * focusNodeId's own doc comment). Deliberately kept out of the
   * presentationFocus/previewFocus dimming logic below (neither of those
   * two derive from this) - navigating here should just move the camera,
   * not dim the rest of the canvas the way an active presentation does. */
  const navigationFocus: FocusSet | null = useMemo(
    () => (focusNodeId ? { nodeIds: [focusNodeId], edgeIds: [] } : null),
    [focusNodeId],
  );
  const activeFocus: FocusSet | null = presentationFocus ?? previewFocus ?? navigationFocus;

  return {
    presentationFocus,
    activeFocus,
  };
}
