import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, Scenario } from "./types";
import type { RequirementsDocument } from "./requirementsTypes";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "./requirementsTypes";
import type { ProgramIncrement } from "./programIncrements";
import type { TeamDocument } from "./teamTypes";
import { EMPTY_TEAM_DOCUMENT, DEFAULT_TEAM_SETTINGS } from "./teamTypes";

export const SCHEMA_VERSION = "0.6";

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
  team: TeamDocument;
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
  programIncrements: ProgramIncrement[],
  team: TeamDocument
): DiagramFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes,
    edges,
    scenarios,
    requirements,
    programIncrements,
    team,
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
  // Files saved before "workable" types existed won't have isWorkable at
  // all on any of their item types - default it to false (not work)
  // rather than leaving it undefined, so downstream code can treat the
  // field as a real boolean instead of needing its own fallback everywhere.
  const itemTypes = Array.isArray(r.itemTypes)
    ? r.itemTypes.map((t) => ({ ...t, isWorkable: t.isWorkable ?? false }))
    : [];
  return {
    itemTypes,
    categories: Array.isArray(r.categories) ? r.categories : [],
    items: Array.isArray(r.items) ? r.items : [],
    relationshipTypes: Array.isArray(r.relationshipTypes) ? r.relationshipTypes : [],
    relationships: Array.isArray(r.relationships) ? r.relationships : [],
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

function parseTeamDocument(raw: unknown): TeamDocument {
  if (!raw || typeof raw !== "object") return EMPTY_TEAM_DOCUMENT;
  const t = raw as Partial<TeamDocument>;
  const settings: TeamDocument["settings"] = {
    defaultPointsPerDay:
      typeof t.settings?.defaultPointsPerDay === "number" && !isNaN(t.settings.defaultPointsPerDay)
        ? t.settings.defaultPointsPerDay
        : DEFAULT_TEAM_SETTINGS.defaultPointsPerDay,
    excludeUsHolidays:
      typeof t.settings?.excludeUsHolidays === "boolean"
        ? t.settings.excludeUsHolidays
        : DEFAULT_TEAM_SETTINGS.excludeUsHolidays,
    extraDaysOff: Array.isArray(t.settings?.extraDaysOff)
      ? (t.settings.extraDaysOff as unknown[]).filter(
          (e): e is TeamDocument["settings"]["extraDaysOff"][number] =>
            !!e &&
            typeof e === "object" &&
            typeof (e as Record<string, unknown>).id === "string" &&
            typeof (e as Record<string, unknown>).date === "string" &&
            typeof (e as Record<string, unknown>).name === "string"
        )
      : [],
  };

  const members: TeamDocument["members"] = Array.isArray(t.members)
    ? (t.members as unknown[])
        .filter(
          (m): m is Record<string, unknown> =>
            !!m &&
            typeof m === "object" &&
            typeof (m as Record<string, unknown>).id === "string" &&
            typeof (m as Record<string, unknown>).name === "string"
        )
        .map((m) => ({
          id: String(m.id),
          name: String(m.name),
          role: typeof m.role === "string" ? m.role : undefined,
          avatarColor: typeof m.avatarColor === "string" ? m.avatarColor : undefined,
          defaultPointsPerDay: typeof m.defaultPointsPerDay === "number" ? m.defaultPointsPerDay : undefined,
          ptoSpans: Array.isArray(m.ptoSpans)
            ? (m.ptoSpans as unknown[]).filter(
                (p): p is TeamDocument["members"][number]["ptoSpans"][number] =>
                  !!p &&
                  typeof p === "object" &&
                  typeof (p as Record<string, unknown>).id === "string" &&
                  typeof (p as Record<string, unknown>).startDate === "string" &&
                  typeof (p as Record<string, unknown>).endDate === "string"
              )
            : [],
        }))
    : [];

  return { members, settings };
}

/**
 * Parses and lightly validates a diagram file loaded from disk.
 * `scenarios`/`requirements`/`programIncrements`/`team` all default to an empty
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
    team: parseTeamDocument(parsed.team),
    metadata: parsed.metadata ?? { updatedAt: new Date().toISOString() },
  };
}
