import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';

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
 * Renders the current diagram (all nodes, not just what's currently in
 * view/zoomed to) by temporarily transforming a clone of React Flow's
 * `.react-flow__viewport` element - this is the standard html-to-image +
 * React Flow recipe. Background/MiniMap/Controls live outside that element,
 * so they're excluded from the export automatically.
 */
async function captureViewport(format: 'png' | 'svg', nodes: Node[]): Promise<string> {
  if (nodes.length === 0) {
    throw new Error('Nothing to export yet - add some nodes first.');
  }
  const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
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

  const options = {
    backgroundColor: EXPORT_BACKGROUND,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    style: {
      width: `${EXPORT_WIDTH}px`,
      height: `${EXPORT_HEIGHT}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    },
  };

  return format === 'png' ? toPng(viewportEl, options) : toSvg(viewportEl, options);
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
export async function captureDiagramSnapshot(
  nodes: Node[],
  format: 'png' | 'svg' = 'png',
): Promise<string | undefined> {
  if (!nodes || nodes.length === 0) return undefined;
  try {
    return await captureViewport(format, nodes);
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

export interface SubsetSnapshotOptions {
  padding?: number;
  width?: number;
  height?: number;
  panOffset?: { x: number; y: number };
  zoomMultiplier?: number;
  format?: 'png' | 'svg';
  backgroundColor?: string;
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
  const targetNodes = allNodes.filter((n) => targetNodeIds.includes(n.id));
  if (targetNodes.length === 0) {
    return undefined;
  }

  const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewportEl) {
    console.warn("Couldn't find .react-flow__viewport to export node subset.");
    return undefined;
  }

  const width = options?.width ?? 1200;
  const height = options?.height ?? 600;
  const padding = options?.padding ?? 0.25;
  const panOffset = options?.panOffset ?? { x: 0, y: 0 };
  const zoomMultiplier = options?.zoomMultiplier ?? 1.0;
  const format = options?.format ?? 'png';
  const bgColor = options?.backgroundColor ?? EXPORT_BACKGROUND;

  try {
    const bounds = getNodesBounds(targetNodes);
    const { x, y, zoom } = getViewportForBounds(
      bounds,
      width,
      height,
      MIN_ZOOM,
      MAX_ZOOM,
      padding,
    );

    const adjustedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * zoomMultiplier));
    const finalX = x + panOffset.x;
    const finalY = y + panOffset.y;

    const renderOptions = {
      backgroundColor: bgColor,
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${finalX}px, ${finalY}px) scale(${adjustedZoom})`,
      },
    };

    return format === 'png' ? toPng(viewportEl, renderOptions) : toSvg(viewportEl, renderOptions);
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
    return format === 'png' ? toPng(containerEl, options) : toSvg(containerEl, options);
  } catch (err) {
    console.warn('Could not capture screen viewport snapshot:', err);
    return undefined;
  }
}

export async function exportDiagramAsSvg(nodes: Node[], title: string): Promise<void> {
  const dataUrl = await captureViewport('svg', nodes);
  downloadDataUrl(dataUrl, `${safeName(title)}.svg`);
}
