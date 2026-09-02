import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, Scenario } from "./types";
import type { RequirementsDocument } from "./requirementsTypes";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "./requirementsTypes";
import type { ProgramIncrement } from "./programIncrements";

export const SCHEMA_VERSION = "0.5";

export interface DiagramFile {
  schemaVersion: string;
  title: string;
  /**
   * Always the FULL top-level tree - any of these nodes may carry a nested
   * `data.subDiagram` (itself possibly nested further), so this one array
   * captures the entire diagram at every drill-down level in a single file.
   * See domain/subDiagramTree.ts for how the app navigates this structure.
   */
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
  scenarios: Scenario[];
  requirements: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  metadata: {
    updatedAt: string;
  };
}

export function toDiagramFile(
  title: string,
  nodes: Node<ArchNodeData>[],
  edges: Edge<ArchEdgeData>[],
  scenarios: Scenario[],
  requirements: RequirementsDocument,
  programIncrements: ProgramIncrement[]
): DiagramFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes,
    edges,
    scenarios,
    requirements,
    programIncrements,
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

function parseRequirementsDocument(raw: unknown): RequirementsDocument {
  if (!raw || typeof raw !== "object") return EMPTY_REQUIREMENTS_DOCUMENT;
  const r = raw as Partial<RequirementsDocument>;
  return {
    itemTypes: Array.isArray(r.itemTypes) ? r.itemTypes : [],
    categories: Array.isArray(r.categories) ? r.categories : [],
    items: Array.isArray(r.items) ? r.items : [],
    nextSequence: r.nextSequence && typeof r.nextSequence === "object" ? r.nextSequence : {},
  };
}

/** A malformed individual PI (missing fields, sprints not an array, etc.)
 * is dropped from the list entirely rather than throwing and blocking the
 * whole file from loading - one corrupted PI shouldn't take down
 * everything else in the document. */
function parseProgramIncrements(raw: unknown): ProgramIncrement[] {
  if (!Array.isArray(raw)) return [];
  const result: ProgramIncrement[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const pi = entry as Partial<ProgramIncrement>;
    if (typeof pi.id !== "string" || typeof pi.name !== "string" || typeof pi.startDate !== "string") continue;
    if (!Array.isArray(pi.sprints)) continue;
    const sprints = pi.sprints.filter(
      (s): s is ProgramIncrement["sprints"][number] =>
        !!s && typeof s === "object" && typeof s.id === "string" && typeof s.name === "string" && typeof s.durationDays === "number"
    );
    result.push({ id: pi.id, name: pi.name, startDate: pi.startDate, sprints });
  }
  return result;
}

/**
 * Parses and lightly validates a diagram file loaded from disk.
 * `scenarios`/`requirements`/`programIncrements` all default to an empty
 * state so files saved before those features existed still open without
 * error - App.tsx's onFileSelected is responsible for further normalizing
 * an empty requirements document to include the built-in item types, same
 * as it already does for scenario steps missing a `path`.
 */
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
    scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
    requirements: parseRequirementsDocument(parsed.requirements),
    programIncrements: parseProgramIncrements(parsed.programIncrements),
    metadata: parsed.metadata ?? { updatedAt: new Date().toISOString() },
  };
}
