import type { RequirementsDocument, RequirementItem } from "./requirementsTypes.ts";
import { isItemWorkable } from "./requirementsRegistry.ts";

export type BuiltInMilestoneType =
  | "release"
  | "deadline"
  | "review"
  | "launch"
  | "code-freeze"
  | "pi-boundary";

export interface MilestoneTypeDefinition {
  id: string;
  label: string;
  iconName: string;
  color: string;
  description: string;
}

export const BUILT_IN_MILESTONE_TYPES: MilestoneTypeDefinition[] = [
  {
    id: "release",
    label: "Release",
    iconName: "package",
    color: "#9061f9", // Purple/Violet
    description: "A planned product, increment, or capability release",
  },
  {
    id: "deadline",
    label: "Deadline",
    iconName: "flag",
    color: "#f0578c",
    description: "A contractual, regulatory, or target deadline",
  },
  {
    id: "review",
    label: "Review",
    iconName: "clipboard-check",
    color: "#06b6d4",
    description: "Architecture, security, or stakeholder review",
  },
  {
    id: "launch",
    label: "Launch",
    iconName: "rocket",
    color: "#0fa36b",
    description: "Production or public go-live event",
  },
  {
    id: "code-freeze",
    label: "Code Freeze",
    iconName: "snowflake",
    color: "#3b82f6",
    description: "Stabilization cutoff date before deployment",
  },
  {
    id: "pi-boundary",
    label: "PI Boundary",
    iconName: "calendar",
    color: "#f59e0b",
    description: "Planning interval transition boundary",
  },
];

export interface Milestone {
  /** Stable unique identifier independent of name or version (FR-011) */
  id: string;
  /** Milestone type: "release" by default, extensible (7.1, 7.2) */
  type: string;
  /** Name/title of the milestone (required, FR-001) */
  name: string;
  /** Scheduled point-in-time date (ISO YYYY-MM-DD, required, FR-001, FR-002, DR-002) */
  scheduledAt: string;
  /** Optional version metadata string (FR-001, FR-012) */
  version?: string;
  /** Optional markdown description (FR-001) */
  description?: string;
  /** Optional custom color override (FR-001) */
  color?: string;
  /** Optional icon override (FR-001) */
  icon?: string;
  /** Generalized list of associated requirement item IDs (Tickets, Epics, Dependencies, etc.) */
  relatedItemIds?: string[];
  /** Backward compatibility alias for older payloads */
  relatedWorkableItemIds?: string[];
  /** ISO timestamp when created */
  createdAt?: string;
  /** ISO timestamp when last updated */
  updatedAt?: string;
}

/** Validation errors representation */
export interface MilestoneValidationError {
  field: keyof Milestone | "general";
  message: string;
}

/**
 * Returns the normalized list of related item IDs for a milestone,
 * checking both `relatedItemIds` and backward-compatible `relatedWorkableItemIds`.
 */
export function getMilestoneRelatedItemIds(milestone: Partial<Milestone>): string[] {
  return sanitizeRelatedItemIds(milestone.relatedItemIds ?? milestone.relatedWorkableItemIds);
}

/**
 * Validates a milestone according to Domain Rules (DR-001..DR-008, Section 12).
 * Returns an array of validation errors (empty if valid).
 */
export function validateMilestone(
  milestone: Partial<Milestone>,
  requirementsDoc?: RequirementsDocument
): MilestoneValidationError[] {
  const errors: MilestoneValidationError[] = [];

  // Required name (FR-001, Section 12)
  if (!milestone.name || milestone.name.trim() === "") {
    errors.push({ field: "name", message: "Milestone name is required." });
  }

  // Required scheduled date (FR-001, FR-002, DR-002, Section 12)
  if (!milestone.scheduledAt || milestone.scheduledAt.trim() === "") {
    errors.push({ field: "scheduledAt", message: "Scheduled date is required." });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(milestone.scheduledAt)) {
    errors.push({ field: "scheduledAt", message: "Scheduled date must be in YYYY-MM-DD format." });
  } else {
    // Check for valid calendar date
    const [y, m, d] = milestone.scheduledAt.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d
    ) {
      errors.push({ field: "scheduledAt", message: "Scheduled date is not a valid calendar date." });
    }
  }

  // Type validation
  if (milestone.type !== undefined && (!milestone.type || milestone.type.trim() === "")) {
    errors.push({ field: "type", message: "Milestone type must not be empty." });
  }

  // Related items validation (FR-005, Section 12)
  const relatedIds = milestone.relatedItemIds ?? milestone.relatedWorkableItemIds;
  if (relatedIds && requirementsDoc) {
    const existingItemIds = new Set(requirementsDoc.items.map((item) => item.id));

    for (const itemId of relatedIds) {
      if (!existingItemIds.has(itemId)) {
        const errorField: keyof Milestone = milestone.relatedItemIds !== undefined ? "relatedItemIds" : "relatedWorkableItemIds";
        errors.push({
          field: errorField,
          message: `Referenced requirement item '${itemId}' does not exist.`,
        });
      }
    }
  }

  return errors;
}

/**
 * Ensures duplicate item IDs are stripped.
 */
export function sanitizeRelatedItemIds(ids: string[] | undefined): string[] {
  if (!ids || !Array.isArray(ids)) return [];
  return Array.from(new Set(ids.filter((id) => typeof id === "string" && id.trim() !== "")));
}

/**
 * Returns the effective color for a milestone (custom override or type default).
 */
export function getMilestoneColor(milestone: Milestone): string {
  if (milestone.color && milestone.color.trim() !== "") {
    return milestone.color;
  }
  const typeDef = BUILT_IN_MILESTONE_TYPES.find((t) => t.id === milestone.type);
  return typeDef?.color ?? "#9061f9";
}

/**
 * Returns the display label for a milestone type.
 */
export function getMilestoneTypeLabel(type: string): string {
  const typeDef = BUILT_IN_MILESTONE_TYPES.find((t) => t.id === type);
  return typeDef?.label ?? (type.charAt(0).toUpperCase() + type.slice(1));
}

/**
 * Returns all milestones scheduled within a given date range [startDate, endDate] inclusive.
 */
export function filterMilestonesByDateRange(
  milestones: Milestone[],
  startDate: string,
  endDate: string
): Milestone[] {
  return milestones.filter(
    (m) => m.scheduledAt >= startDate && m.scheduledAt <= endDate
  );
}

/**
 * Returns all milestones that reference a given requirement item ID (FR-005).
 */
export function findMilestonesForItem(
  milestones: Milestone[],
  itemId: string
): Milestone[] {
  return milestones.filter((m) => {
    const ids = getMilestoneRelatedItemIds(m);
    return ids.includes(itemId);
  });
}

/**
 * Returns all milestones that reference a given workable item ID (FR-007, Section 13, backwards-compatible alias).
 */
export function findMilestonesForWorkableItem(
  milestones: Milestone[],
  workableItemId: string
): Milestone[] {
  return findMilestonesForItem(milestones, workableItemId);
}

/**
 * Returns all RequirementItems linked to a given milestone.
 */
export function getMilestoneItems(
  milestone: Milestone,
  doc: RequirementsDocument
): RequirementItem[] {
  const ids = new Set(getMilestoneRelatedItemIds(milestone));
  return doc.items.filter((item) => ids.has(item.id));
}

/**
 * Returns workable items linked to a given milestone.
 */
export function getMilestoneWorkableItems(
  milestone: Milestone,
  doc: RequirementsDocument
): RequirementItem[] {
  return getMilestoneItems(milestone, doc).filter((item) => isItemWorkable(doc, item));
}

/**
 * Returns non-workable items linked to a given milestone (e.g. Epics, Dependencies, Requirements, Goals).
 */
export function getMilestoneNonWorkableItems(
  milestone: Milestone,
  doc: RequirementsDocument
): RequirementItem[] {
  return getMilestoneItems(milestone, doc).filter((item) => !isItemWorkable(doc, item));
}

/**
 * Returns items linked to a given milestone filtered by typeId (e.g. "epic", "dependency", "ticket").
 */
export function filterMilestoneItemsByType(
  milestone: Milestone,
  doc: RequirementsDocument,
  typeId: string
): RequirementItem[] {
  return getMilestoneItems(milestone, doc).filter((item) => item.typeId === typeId);
}

/**
 * Returns true if a milestone has zero capacity / workload (DR-001, DR-004, AC-003).
 * By definition in the domain model, milestones contribute 0 points / hours / days.
 */
export function getMilestoneCapacityWorkload(_milestone?: Milestone): number {
  void _milestone;
  return 0;
}
