import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";

const EXPORT_WIDTH = 1600;
const EXPORT_HEIGHT = 1000;
const EXPORT_PADDING = 0.15;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const EXPORT_BACKGROUND = "#0f1117";

function safeName(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "diagram";
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement("a");
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
async function captureViewport(format: "png" | "svg", nodes: Node[]): Promise<string> {
  if (nodes.length === 0) {
    throw new Error("Nothing to export yet - add some nodes first.");
  }
  const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewportEl) {
    throw new Error("Couldn't find the canvas to export.");
  }

  const bounds = getNodesBounds(nodes);
  const { x, y, zoom } = getViewportForBounds(bounds, EXPORT_WIDTH, EXPORT_HEIGHT, MIN_ZOOM, MAX_ZOOM, EXPORT_PADDING);

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

  return format === "png" ? toPng(viewportEl, options) : toSvg(viewportEl, options);
}

export async function exportDiagramAsPng(nodes: Node[], title: string): Promise<void> {
  const dataUrl = await captureViewport("png", nodes);
  downloadDataUrl(dataUrl, `${safeName(title)}.png`);
}

/**
 * Note: this is an SVG *snapshot* (DOM content embedded via foreignObject),
 * not a hand-serialized vector SVG with plain <path>/<text> elements. It
 * renders correctly in browsers and scales fine for docs/wikis, but may not
 * behave like a "clean" vector file in every design tool (e.g. Illustrator).
 * A true vector exporter is a bigger, separate undertaking if that's ever needed.
 */
export async function exportDiagramAsSvg(nodes: Node[], title: string): Promise<void> {
  const dataUrl = await captureViewport("svg", nodes);
  downloadDataUrl(dataUrl, `${safeName(title)}.svg`);
}
