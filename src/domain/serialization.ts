import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "./types";

export const SCHEMA_VERSION = "0.1";

export interface DiagramFile {
  schemaVersion: string;
  title: string;
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
  metadata: {
    updatedAt: string;
  };
}

export function toDiagramFile(
  title: string,
  nodes: Node<ArchNodeData>[],
  edges: Edge<ArchEdgeData>[]
): DiagramFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes,
    edges,
    metadata: { updatedAt: new Date().toISOString() },
  };
}

/** Triggers a browser download of the diagram as a .json file. */
export function downloadDiagram(file: DiagramFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const safeName = file.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  anchor.download = `${safeName || "diagram"}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Parses and lightly validates a diagram file loaded from disk. */
export function parseDiagramFile(raw: string): DiagramFile {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) {
    throw new Error("File does not look like a diagram export (missing nodes/edges).");
  }
  return {
    schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
    title: parsed.title ?? "Untitled Diagram",
    nodes: parsed.nodes,
    edges: parsed.edges,
    metadata: parsed.metadata ?? { updatedAt: new Date().toISOString() },
  };
}
