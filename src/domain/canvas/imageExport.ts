import {getNodesBounds, getViewportForBounds, type Node} from '@xyflow/react';
import {toCanvas, toJpeg, toPng, toSvg} from 'html-to-image';
import {findNodesContainedInRect, getDescendantIds, toAbsolutePosition} from './graphUtils';

const EXPORT_WIDTH = 1600;
const EXPORT_HEIGHT = 1000;
const EXPORT_PADDING = 0.15;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const EXPORT_BACKGROUND = '#0f1117';

function safeName(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'diagram'
  );
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * A capture's file format. JPEG is for images embedded in other documents -
 * the SRD's snapshots - where it is several times cheaper to place in a PDF
 * than a PNG with transparency; captures have an opaque background, so it
 * loses nothing there but a little fidelity.
 */
export type CaptureFormat = 'png' | 'svg' | 'jpeg';

/** Room around a frame within which a node still counts as in it, so a
 * node's shadow or border just outside the frame is kept. */
const FRAME_MARGIN = 24;

/** High enough that text in a capture stays sharp at print sizes. */
const JPEG_QUALITY = 0.92;

function encode(
  format: CaptureFormat,
  element: HTMLElement,
  options: Parameters<typeof toPng>[1],
): Promise<string> {
  if (format === 'jpeg') return toJpeg(element, { ...options, quality: JPEG_QUALITY });
  return format === 'png' ? toPng(element, options) : toSvg(element, options);
}

/**
 * Where and how to capture. Defaults capture the editor's own canvas at the
 * device's pixel ratio, which is what the PNG/SVG exports want. A caller
 * rendering its own canvas (the SRD capture surface) passes that canvas as
 * `root`, and pins `pixelRatio` so the result does not depend on the screen.
 */
export interface CaptureTarget {
  /** The element containing the React Flow canvas to capture. */
  root?: ParentNode;
  pixelRatio?: number;
  /**
   * The page's web fonts as CSS, from html-to-image's getFontEmbedCSS. By
   * default every capture re-reads the stylesheets and inlines every font;
   * a caller capturing repeatedly computes it once and passes it in.
   */
  fontEmbedCSS?: string;
  /**
   * Capture in this many tiles, stitched into one image. Each tile clones
   * only the nodes it shows, so no single step blocks the page for long, and
   * `betweenTiles` runs before every tile after the first - to wait for a
   * pause in the user's work, say. Whole-diagram PNG and JPEG only.
   */
  tiles?: { columns: number; rows: number; betweenTiles?: () => Promise<void> };
}

/**
 * html-to-image's filter keeping only the nodes that fall inside a frame,
 * given the transform (offset, zoom) that places the diagram in it. Cloning
 * copies every element's computed styles, most of a capture's cost, and
 * nodes outside the frame cannot appear in the image anyway. Edges are kept:
 * they are few and cheap.
 */
function keepNodesInFrame(
  nodes: Node[],
  frame: { x: number; y: number; zoom: number; width: number; height: number },
): (el: HTMLElement) => boolean {
  const inFrame = new Set(
    nodes
      .filter((n) => {
        const r = calculateNodesAbsoluteBounds([n], nodes);
        const left = r.x * frame.zoom + frame.x;
        const top = r.y * frame.zoom + frame.y;
        return (
          left < frame.width + FRAME_MARGIN &&
          top < frame.height + FRAME_MARGIN &&
          left + r.width * frame.zoom > -FRAME_MARGIN &&
          top + r.height * frame.zoom > -FRAME_MARGIN
        );
      })
      .map((n) => n.id),
  );
  return (el) =>
    !(el.classList?.contains('react-flow__node') && !inFrame.has(el.dataset?.id ?? ''));
}

function findViewport(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>('.react-flow__viewport');
}

/**
 * Renders the current diagram (all nodes, not just what's currently in
 * view/zoomed to) by temporarily transforming a clone of React Flow's
 * `.react-flow__viewport` element - this is the standard html-to-image +
 * React Flow recipe. Background/MiniMap/Controls live outside that element,
 * so they're excluded from the export automatically.
 */
async function captureViewport(
  format: CaptureFormat,
  nodes: Node[],
  target: CaptureTarget = {},
): Promise<string> {
  if (nodes.length === 0) {
    throw new Error('Nothing to export yet - add some nodes first.');
  }
  const viewportEl = findViewport(target.root);
  if (!viewportEl) {
    throw new Error("Couldn't find the canvas to export.");
  }

  const bounds = getNodesBounds(nodes);
  const { x, y, zoom } = getViewportForBounds(
    bounds,
    EXPORT_WIDTH,
    EXPORT_HEIGHT,
    MIN_ZOOM,
    MAX_ZOOM,
    EXPORT_PADDING,
  );

  if (target.tiles && format !== 'svg') {
    return captureInTiles(format, viewportEl, nodes, { x, y, zoom }, target);
  }

  const options = {
    backgroundColor: EXPORT_BACKGROUND,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    pixelRatio: target.pixelRatio,
    fontEmbedCSS: target.fontEmbedCSS,
    style: {
      width: `${EXPORT_WIDTH}px`,
      height: `${EXPORT_HEIGHT}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    },
  };

  return encode(format, viewportEl, options);
}

export async function exportDiagramAsPng(nodes: Node[], title: string): Promise<void> {
  const dataUrl = await captureViewport('png', nodes);
  downloadDataUrl(dataUrl, `${safeName(title)}.png`);
}

/**
 * Note: this is an SVG *snapshot* (DOM content embedded via foreignObject),
 * not a hand-serialized vector SVG with plain <path>/<text> elements. It
 * renders correctly in browsers and scales fine for docs/wikis, but may not
 * behave like a "clean" vector file in every design tool (e.g. Illustrator).
 * A true vector exporter is a bigger, separate undertaking if that's ever needed.
 */
/** The whole-diagram capture, tile by tile (see CaptureTarget.tiles). */
async function captureInTiles(
  format: 'png' | 'jpeg',
  viewportEl: HTMLElement,
  nodes: Node[],
  view: { x: number; y: number; zoom: number },
  target: CaptureTarget,
): Promise<string> {
  const { columns, rows, betweenTiles } = target.tiles!;
  const ratio = target.pixelRatio ?? 1;
  const out = document.createElement('canvas');
  out.width = Math.round(EXPORT_WIDTH * ratio);
  out.height = Math.round(EXPORT_HEIGHT * ratio);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, out.width, out.height);
  const tileWidth = Math.ceil(EXPORT_WIDTH / columns);
  const tileHeight = Math.ceil(EXPORT_HEIGHT / rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (row + column > 0) await betweenTiles?.();
      const left = column * tileWidth;
      const top = row * tileHeight;
      const width = Math.min(tileWidth, EXPORT_WIDTH - left);
      const height = Math.min(tileHeight, EXPORT_HEIGHT - top);
      // The same view, shifted so this tile's region lands at its origin.
      const frame = { x: view.x - left, y: view.y - top, zoom: view.zoom, width, height };
      const tile = await toCanvas(viewportEl, {
        backgroundColor: EXPORT_BACKGROUND,
        width,
        height,
        pixelRatio: ratio,
        fontEmbedCSS: target.fontEmbedCSS,
        filter: keepNodesInFrame(nodes, frame),
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${frame.x}px, ${frame.y}px) scale(${frame.zoom})`,
        },
      });
      ctx.drawImage(tile, Math.round(left * ratio), Math.round(top * ratio));
    }
  }
  return format === 'jpeg' ? out.toDataURL('image/jpeg', JPEG_QUALITY) : out.toDataURL('image/png');
}

export async function captureDiagramSnapshot(
  nodes: Node[],
  format: CaptureFormat = 'png',
  target?: CaptureTarget,
): Promise<string | undefined> {
  if (!nodes || nodes.length === 0) return undefined;
  try {
    return await captureViewport(format, nodes, target);
  } catch (err) {
    console.warn('Could not capture diagram snapshot:', err);
    return undefined;
  }
}

/**
 * Captures specifically the selected nodes, framing the snapshot
 * tightly around the selection. Falls back to all nodes if selection is empty.
 */
export async function captureSelectedNodesSnapshot(
  allNodes: Node[],
  selectedNodeIds: string[],
  format: 'png' | 'svg' = 'png',
): Promise<string | undefined> {
  const targetNodes =
    selectedNodeIds && selectedNodeIds.length > 0
      ? allNodes.filter((n) => selectedNodeIds.includes(n.id))
      : allNodes;
  return captureDiagramSnapshot(targetNodes, format);
}

export interface SubsetSnapshotOptions extends CaptureTarget {
  padding?: number;
  width?: number;
  height?: number;
  panOffset?: { x: number; y: number };
  zoomMultiplier?: number;
  format?: CaptureFormat;
  backgroundColor?: string;
}

/**
 * Calculates the bounding box of a list of nodes in absolute canvas coordinates,
 * resolving parentId relative offsets and explicit or fallback node dimensions.
 */
export function calculateNodesAbsoluteBounds(
  nodesToMeasure: Node[],
  allNodes: Node[],
): { x: number; y: number; width: number; height: number } {
  if (nodesToMeasure.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodesToMeasure) {
    const absPos = toAbsolutePosition(n, allNodes, n.parentId);
    let w = n.measured?.width ?? n.width;
    let h = n.measured?.height ?? n.height;

    if (w == null && n.style?.width != null) {
      w = typeof n.style.width === 'number' ? n.style.width : parseFloat(String(n.style.width));
    }
    if (h == null && n.style?.height != null) {
      h = typeof n.style.height === 'number' ? n.style.height : parseFloat(String(n.style.height));
    }
    if (w == null && (n as { initialWidth?: number }).initialWidth != null) {
      w = (n as { initialWidth?: number }).initialWidth;
    }
    if (h == null && (n as { initialHeight?: number }).initialHeight != null) {
      h = (n as { initialHeight?: number }).initialHeight;
    }

    if (!w || isNaN(w) || w <= 0) {
      w = n.type === 'group' ? 320 : n.type === 'text' ? 140 : 180;
    }
    if (!h || isNaN(h) || h <= 0) {
      h = n.type === 'group' ? 220 : n.type === 'text' ? 40 : 80;
    }

    minX = Math.min(minX, absPos.x);
    minY = Math.min(minY, absPos.y);
    maxX = Math.max(maxX, absPos.x + w);
    maxY = Math.max(maxY, absPos.y + h);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Captures a focused snapshot tightly centered on a subset of nodes (e.g. linked
 * requirement nodes) with optional pan offsets and zoom adjustment for framing.
 */
export async function captureNodeSubsetSnapshot(
  allNodes: Node[],
  targetNodeIds: string[],
  options?: SubsetSnapshotOptions,
): Promise<string | undefined> {
  if (!allNodes || allNodes.length === 0 || !targetNodeIds || targetNodeIds.length === 0) {
    return undefined;
  }

  // Include descendant nodes if any target node is a group container,
  // as well as any nodes geometrically contained within group boundaries.
  const targetIdSet = new Set<string>(targetNodeIds);
  for (const id of targetNodeIds) {
    const descendants = getDescendantIds(id, allNodes);
    for (const dId of descendants) {
      targetIdSet.add(dId);
    }
    const targetNode = allNodes.find((n) => n.id === id);
    if (targetNode?.type === 'group') {
      const absPos = toAbsolutePosition(targetNode, allNodes, targetNode.parentId);
      let groupW = targetNode.measured?.width ?? targetNode.width;
      let groupH = targetNode.measured?.height ?? targetNode.height;
      if (groupW == null && targetNode.style?.width != null) {
        groupW =
          typeof targetNode.style.width === 'number'
            ? targetNode.style.width
            : parseFloat(String(targetNode.style.width));
      }
      if (groupH == null && targetNode.style?.height != null) {
        groupH =
          typeof targetNode.style.height === 'number'
            ? targetNode.style.height
            : parseFloat(String(targetNode.style.height));
      }
      const w = groupW && !isNaN(groupW) && groupW > 0 ? groupW : 320;
      const h = groupH && !isNaN(groupH) && groupH > 0 ? groupH : 220;
      const contained = findNodesContainedInRect(
        { x: absPos.x, y: absPos.y, width: w, height: h },
        allNodes,
      );
      for (const cNode of contained) {
        targetIdSet.add(cNode.id);
      }
    }
  }

  const targetNodes = allNodes.filter((n) => targetIdSet.has(n.id));
  if (targetNodes.length === 0) {
    return undefined;
  }

  const viewportEl = findViewport(options?.root);
  if (!viewportEl) {
    console.warn("Couldn't find .react-flow__viewport to export node subset.");
    return undefined;
  }

  const renderedTargetNodes = targetNodes.filter((n) =>
    Boolean(viewportEl.querySelector(`[data-id="${n.id}"]`)),
  );
  if (renderedTargetNodes.length === 0) {
    return undefined;
  }

  const width = options?.width ?? 1200;
  const height = options?.height ?? 600;
  const padding = options?.padding ?? 0.06;
  const panOffset = options?.panOffset ?? { x: 0, y: 0 };
  const zoomMultiplier = options?.zoomMultiplier ?? 1.0;
  const format = options?.format ?? 'png';
  const bgColor = options?.backgroundColor ?? EXPORT_BACKGROUND;

  try {
    const bounds = calculateNodesAbsoluteBounds(targetNodes, allNodes);

    const paddingFraction = Math.max(0, Math.min(0.2, padding));
    const effectiveW = width * (1 - paddingFraction * 2);
    const effectiveH = height * (1 - paddingFraction * 2);

    const baseZoom = Math.min(effectiveW / bounds.width, effectiveH / bounds.height);
    const MIN_SUBSET_ZOOM = 0.2;
    const MAX_SUBSET_ZOOM = 4.0;
    const clampedBaseZoom = Math.min(MAX_SUBSET_ZOOM, Math.max(MIN_SUBSET_ZOOM, baseZoom));
    const adjustedZoom = Math.min(
      MAX_SUBSET_ZOOM,
      Math.max(MIN_SUBSET_ZOOM, clampedBaseZoom * zoomMultiplier),
    );

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    const finalX = width / 2 + panOffset.x - centerX * adjustedZoom;
    const finalY = height / 2 + panOffset.y - centerY * adjustedZoom;

    const renderOptions = {
      backgroundColor: bgColor,
      width,
      height,
      pixelRatio: options?.pixelRatio,
      fontEmbedCSS: options?.fontEmbedCSS,
      // Only the nodes inside the frame are cloned (see keepNodesInFrame).
      filter: keepNodesInFrame(allNodes, {
        x: finalX,
        y: finalY,
        zoom: adjustedZoom,
        width,
        height,
      }),
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${finalX}px, ${finalY}px) scale(${adjustedZoom})`,
      },
    };

    return await encode(format, viewportEl, renderOptions);
  } catch (err) {
    console.warn('Could not capture node subset snapshot:', err);
    return undefined;
  }
}

/**
 * Captures the exact currently visible screen viewport of the canvas as seen
 * by the user (respecting manual pan and zoom positions).
 */
export async function captureCurrentScreenViewport(
  format: 'png' | 'svg' = 'png',
): Promise<string | undefined> {
  const containerEl = document.querySelector<HTMLElement>('.react-flow');
  if (!containerEl) {
    console.warn("Couldn't find .react-flow container to export.");
    return undefined;
  }
  try {
    const options = {
      backgroundColor: EXPORT_BACKGROUND,
    };
    return await (format === 'png' ? toPng(containerEl, options) : toSvg(containerEl, options));
  } catch (err) {
    console.warn('Could not capture screen viewport snapshot:', err);
    return undefined;
  }
}

export async function exportDiagramAsSvg(nodes: Node[], title: string): Promise<void> {
  const dataUrl = await captureViewport('svg', nodes);
  downloadDataUrl(dataUrl, `${safeName(title)}.svg`);
}
