/**
 * Level of detail on the canvas.
 *
 * A diagram fitted to the screen is drawn well below full size - a 30-node
 * system lands around 40% - and at that size a node's name is a few pixels
 * tall. The name is the one thing an overview is for, so below a zoom
 * threshold the canvas switches to an "overview" level: each node shows
 * only its name, drawn larger the further out the view is, and the
 * subtitle, property chips and badges that can't be read anyway are
 * hidden. Nothing changes size - the name is drawn over the node's
 * existing box - so edges and layout stay exactly where they were.
 *
 * The level is a pair of values on the canvas element (data-lod and
 * --lod-scale) that the stylesheet reads. Nodes don't subscribe to the
 * zoom, so zooming re-renders none of them.
 */
export type LevelOfDetail = 'detail' | 'overview';

/** Below this zoom the canvas shows the overview level. */
export const OVERVIEW_ZOOM = 0.6;
/** The zoom at which overview text is the size detail text is at 100%. */
const READABLE_AT = 0.85;
/** Past this the name no longer fits a node's box. */
export const MAX_LOD_SCALE = 2.4;
/** Scale moves in steps so a slow zoom doesn't restyle on every frame. */
const SCALE_STEP = 0.1;

export interface LodState {
  lod: LevelOfDetail;
  /** What overview text is multiplied by; 1 at the detail level. */
  scale: number;
}

export function lodForZoom(zoom: number): LodState {
  if (!(zoom > 0) || zoom >= OVERVIEW_ZOOM) return { lod: 'detail', scale: 1 };
  const raw = Math.min(MAX_LOD_SCALE, READABLE_AT / zoom);
  return { lod: 'overview', scale: Math.round(raw / SCALE_STEP) * SCALE_STEP };
}

export const LOD_ATTRIBUTE = 'data-lod';
export const LOD_SCALE_PROPERTY = '--lod-scale';

/** Writes `state` onto the canvas element, touching the DOM only when
 * something changed. */
export function applyLod(element: HTMLElement, state: LodState): void {
  if (element.getAttribute(LOD_ATTRIBUTE) !== state.lod) {
    element.setAttribute(LOD_ATTRIBUTE, state.lod);
  }
  const scale = state.scale.toFixed(1);
  if (element.style.getPropertyValue(LOD_SCALE_PROPERTY) !== scale) {
    element.style.setProperty(LOD_SCALE_PROPERTY, scale);
  }
}

/**
 * Runs `capture` with the canvas around `element` at full detail, then puts
 * the level back. An exported image is drawn at its own zoom, whatever the
 * editor happens to be showing, and must not inherit the overview styling
 * of a zoomed-out view.
 */
export async function withFullDetail<T>(
  element: HTMLElement,
  capture: () => Promise<T>,
): Promise<T> {
  const canvas =
    element.closest<HTMLElement>(`[${LOD_ATTRIBUTE}]`) ??
    element.querySelector<HTMLElement>(`[${LOD_ATTRIBUTE}]`);
  const previous = canvas?.getAttribute(LOD_ATTRIBUTE);
  if (!canvas || previous === 'detail') return capture();
  canvas.setAttribute(LOD_ATTRIBUTE, 'detail');
  try {
    return await capture();
  } finally {
    if (previous) canvas.setAttribute(LOD_ATTRIBUTE, previous);
  }
}
