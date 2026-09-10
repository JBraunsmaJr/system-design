import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData, Scenario } from "./types.ts";
import type { RequirementsDocument } from "./requirementsTypes.ts";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "./requirementsTypes.ts";
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from "./requirementsRegistry.ts";
import type { ProgramIncrement } from "./programIncrements.ts";
import { DEFAULT_SPRINT_DURATION_DAYS } from "./programIncrements.ts";
import type { TeamDocument } from "./teamTypes.ts";
import { EMPTY_TEAM_DOCUMENT, DEFAULT_TEAM_SETTINGS } from "./teamTypes.ts";
import type { Milestone } from "./milestones.ts";
import { sanitizeRelatedItemIds, validateMilestone } from "./milestones.ts";
import { globalShapeRegistry, type ShapeDefinition } from "./shapeRegistry.ts";
import { globalIconRegistry, type IconDefinition } from "./iconRegistry.ts";

export const SCHEMA_VERSION = "0.7";

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
  milestones?: Milestone[];
  shapeFallbacks?: Record<string, ShapeDefinition>;
  iconFallbacks?: Record<string, IconDefinition>;
  metadata: {
    updatedAt: string;
  };
}

function collectAssetFallbacks(nodes: Node<ArchNodeData>[]): {
  shapeFallbacks: Record<string, ShapeDefinition>;
  iconFallbacks: Record<string, IconDefinition>;
} {
  const shapeFallbacks: Record<string, ShapeDefinition> = {};
  const iconFallbacks: Record<string, IconDefinition> = {};

  function scanNode(node: Node<ArchNodeData>) {
    if (node.type === "shape" && node.data?.nodeType) {
      const shapeDef = globalShapeRegistry.getShape(node.data.nodeType);
      if (shapeDef) {
        shapeFallbacks[shapeDef.id] = shapeDef;
      }
    }
    if (node.data?.icon) {
      const iconDef = globalIconRegistry.getIcon(node.data.icon);
      if (iconDef && iconDef.source.type !== "builtin") {
        iconFallbacks[iconDef.id] = iconDef;
      }
    }
    if (node.data?.subDiagram?.nodes) {
      for (const child of node.data.subDiagram.nodes) {
        scanNode(child);
      }
    }
  }

  for (const node of nodes) {
    scanNode(node);
  }

  return { shapeFallbacks, iconFallbacks };
}

export function toDiagramFile(
  title: string,
  nodes: Node<ArchNodeData>[],
  edges: Edge<ArchEdgeData>[],
  scenarios: Scenario[],
  requirements: RequirementsDocument,
  programIncrements: ProgramIncrement[],
  team: TeamDocument,
  milestones: Milestone[] = []
): DiagramFile {
  const { shapeFallbacks, iconFallbacks } = collectAssetFallbacks(nodes);

  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes,
    edges,
    scenarios,
    requirements,
    programIncrements,
    team,
    milestones,
    ...(Object.keys(shapeFallbacks).length > 0 ? { shapeFallbacks } : {}),
    ...(Object.keys(iconFallbacks).length > 0 ? { iconFallbacks } : {}),
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
  const itemTypes = Array.isArray(r.itemTypes)
    ? r.itemTypes.map((t) => ({
        ...t,
        isWorkable: t.isWorkable ?? BUILT_IN_ITEM_TYPES.find((b) => b.id === t.id)?.isWorkable ?? false,
      }))
    : [];
  const relationshipTypes = Array.isArray(r.relationshipTypes)
    ? r.relationshipTypes.map((t) => ({
        ...t,
        isBlocking: t.isBlocking ?? BUILT_IN_RELATIONSHIP_TYPES.find((b) => b.id === t.id)?.isBlocking ?? false,
      }))
    : [];
  return {
    itemTypes,
    categories: Array.isArray(r.categories) ? r.categories : [],
    items: Array.isArray(r.items) ? r.items : [],
    relationshipTypes,
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
    if (typeof pi.id !== "string" || typeof pi.name !== "string" || typeof pi.startDate !== "string") {
      continue;
    }
    if (!Array.isArray(pi.sprints)) continue;

    const sprints = (pi.sprints as unknown[])
      .filter(
        (s): s is Record<string, unknown> =>
          !!s &&
          typeof s === "object" &&
          typeof (s as Record<string, unknown>).id === "string" &&
          typeof (s as Record<string, unknown>).name === "string"
      )
      .map((s) => ({
        id: String(s.id),
        name: String(s.name),
        durationDays:
          typeof s.durationDays === "number" && s.durationDays > 0
            ? s.durationDays
            : DEFAULT_SPRINT_DURATION_DAYS,
      }));

    const reservations = Array.isArray(pi.reservations)
      ? (pi.reservations as unknown[])
          .filter(
            (r): r is Record<string, unknown> =>
              !!r &&
              typeof r === "object" &&
              typeof (r as Record<string, unknown>).id === "string" &&
              (typeof (r as Record<string, unknown>).name === "string" || typeof (r as Record<string, unknown>).title === "string") &&
              (typeof (r as Record<string, unknown>).value === "number" || typeof (r as Record<string, unknown>).points === "number")
          )
          .map((rec) => ({
            id: String(rec.id),
            name: String(rec.name ?? rec.title),
            unit: (rec.unit === "points" ? "points" : "percentage") as "percentage" | "points",
            value: Number(rec.value ?? rec.points),
            sprintId: typeof rec.sprintId === "string" && rec.sprintId.trim() !== "" ? rec.sprintId : undefined,
            category: typeof rec.category === "string" ? rec.category : undefined,
            note: typeof rec.note === "string" ? rec.note : undefined,
          }))
      : undefined;

    result.push({
      id: pi.id,
      name: pi.name,
      startDate: pi.startDate,
      sprints,
      ...(reservations && reservations.length > 0 ? { reservations } : {}),
    });
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

function parseMilestones(raw: unknown): Milestone[] {
  if (!Array.isArray(raw)) return [];
  const result: Milestone[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Partial<Milestone>;
    if (typeof m.id !== "string" || typeof m.name !== "string" || typeof m.scheduledAt !== "string") continue;
    const sanitizedIds = sanitizeRelatedItemIds(m.relatedItemIds ?? m.relatedWorkableItemIds);
    const candidate: Milestone = {
      id: m.id,
      type: typeof m.type === "string" && m.type.trim() !== "" ? m.type : "release",
      name: m.name.trim(),
      scheduledAt: m.scheduledAt,
      version: typeof m.version === "string" ? m.version : undefined,
      description: typeof m.description === "string" ? m.description : undefined,
      color: typeof m.color === "string" ? m.color : undefined,
      icon: typeof m.icon === "string" ? m.icon : undefined,
      relatedItemIds: sanitizedIds,
      relatedWorkableItemIds: sanitizedIds,
      createdAt: typeof m.createdAt === "string" ? m.createdAt : undefined,
      updatedAt: typeof m.updatedAt === "string" ? m.updatedAt : undefined,
    };
    const errors = validateMilestone(candidate);
    if (errors.length > 0) continue;
    result.push(candidate);
  }
  return result;
}

/**
 * Parses and lightly validates a diagram file loaded from disk.
 * `scenarios`/`requirements`/`programIncrements`/`team`/`milestones` all default to an empty
 * state so files saved before those features existed still open without
 * error.
 */
export function parseDiagramFile(raw: string): DiagramFile {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) {
    throw new Error("File does not look like a diagram export (missing nodes/edges).");
  }

  // Restore fallback definitions into registries if present
  if (parsed.shapeFallbacks && typeof parsed.shapeFallbacks === "object") {
    for (const [id, def] of Object.entries(parsed.shapeFallbacks)) {
      if (def && typeof def === "object" && !globalShapeRegistry.getShape(id)) {
        try {
          globalShapeRegistry.registerShape(def as ShapeDefinition);
        } catch {
          // Ignore registration failures for corrupted fallbacks
        }
      }
    }
  }

  if (parsed.iconFallbacks && typeof parsed.iconFallbacks === "object") {
    for (const [id, def] of Object.entries(parsed.iconFallbacks)) {
      if (def && typeof def === "object" && !globalIconRegistry.getIcon(id)) {
        try {
          globalIconRegistry.registerIcon(def as IconDefinition);
        } catch {
          // Ignore registration failures for corrupted fallbacks
        }
      }
    }
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
    milestones: parseMilestones(parsed.milestones),
    shapeFallbacks: parsed.shapeFallbacks,
    iconFallbacks: parsed.iconFallbacks,
    metadata: parsed.metadata ?? { updatedAt: new Date().toISOString() },
  };
}
