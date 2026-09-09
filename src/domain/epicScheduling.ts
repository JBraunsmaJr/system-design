import type { RequirementsDocument, RequirementItem, EpicInferredSchedule } from "./requirementsTypes.ts";
import type { ProgramIncrement, SprintDateRange } from "./programIncrements.ts";
import { computeSprintDateRanges, parseISODate, formatISODate } from "./programIncrements.ts";
import { isItemWorkable } from "./requirementsRegistry.ts";
import type { Milestone } from "./milestones.ts";
import { getMilestoneRelatedItemIds } from "./milestones.ts";

/**
 * Returns all child requirement items directly linked to a parent (e.g. Epic).
 * Checks both "parent-of" (from parent to child) and "child-of" (from child to parent).
 */
export function getChildItemsForParent(
  parentId: string,
  doc: RequirementsDocument
): RequirementItem[] {
  const childItemIds = new Set<string>();

  for (const rel of doc.relationships) {
    if (rel.fromItemId === parentId && (rel.typeId === "parent-of" || rel.typeId === "relates-to")) {
      childItemIds.add(rel.toItemId);
    } else if (rel.toItemId === parentId && rel.typeId === "child-of") {
      childItemIds.add(rel.fromItemId);
    }
  }

  return doc.items.filter((item) => childItemIds.has(item.id));
}

/**
 * Computes the inferred schedule (start date, end date, completeness, story point totals)
 * for an Epic or grouped parent item based on child workable items and linked milestone anchors.
 */
export function computeEpicInferredSchedule(
  epicId: string,
  doc: RequirementsDocument,
  programIncrements: ProgramIncrement[],
  milestones: Milestone[] = []
): EpicInferredSchedule {
  const childItems = getChildItemsForParent(epicId, doc);
  const childItemIds = childItems.map((item) => item.id);
  const workableChildren = childItems.filter((item) => isItemWorkable(doc, item));

  // 1. Build fast sprintId -> SprintDateRange lookup
  const sprintRanges = new Map<string, SprintDateRange>();
  for (const pi of programIncrements) {
    for (const range of computeSprintDateRanges(pi)) {
      sprintRanges.set(range.sprintId, range);
    }
  }

  let minStartDays = Infinity;
  let maxEndDays = -Infinity;
  let scheduledCount = 0;
  let completedCount = 0;
  let totalPoints = 0;
  const scheduledSprintIds = new Set<string>();

  for (const child of workableChildren) {
    if (typeof child.points === "number" && !isNaN(child.points)) {
      totalPoints += child.points;
    }
    if (child.status === "done") {
      completedCount++;
    }

    if (child.sprintId && sprintRanges.has(child.sprintId)) {
      scheduledCount++;
      scheduledSprintIds.add(child.sprintId);
      const range = sprintRanges.get(child.sprintId)!;
      minStartDays = Math.min(minStartDays, parseISODate(range.startDate));
      maxEndDays = Math.max(maxEndDays, parseISODate(range.endDate));
    }
  }

  // 2. Find explicit milestone boundaries linked to this Epic
  const linkedMilestones = milestones.filter((m) => {
    const ids = getMilestoneRelatedItemIds(m);
    return ids.includes(epicId) && m.scheduledAt && /^\d{4}-\d{2}-\d{2}$/.test(m.scheduledAt);
  });

  let milestoneMinDays = Infinity;
  let milestoneMaxDays = -Infinity;

  for (const m of linkedMilestones) {
    const day = parseISODate(m.scheduledAt);
    milestoneMinDays = Math.min(milestoneMinDays, day);
    milestoneMaxDays = Math.max(milestoneMaxDays, day);
  }

  // 3. Date derivation logic adhering to DR-002, DR-003, DR-004
  let startDate: string | undefined;
  let endDate: string | undefined;
  let isFullyScheduled = false;

  if (workableChildren.length > 0) {
    // Has workable items
    if (scheduledCount > 0) {
      const effectiveStart = milestoneMinDays !== Infinity
        ? Math.min(minStartDays, milestoneMinDays)
        : minStartDays;
      startDate = formatISODate(effectiveStart);
    } else if (milestoneMinDays !== Infinity) {
      startDate = formatISODate(milestoneMinDays);
    }

    if (scheduledCount === workableChildren.length) {
      isFullyScheduled = true;
      endDate = formatISODate(maxEndDays);
    } else {
      isFullyScheduled = false;
      endDate = undefined; // Strictly undefined when one or more child workable items remain unscheduled
    }
  } else {
    // 0 workable children: check for dual-milestone or single-milestone anchoring
    if (linkedMilestones.length > 0) {
      startDate = formatISODate(milestoneMinDays);
      if (linkedMilestones.length >= 2 || milestoneMaxDays > milestoneMinDays) {
        endDate = formatISODate(milestoneMaxDays);
        isFullyScheduled = true;
      } else {
        // Single milestone anchor
        endDate = undefined;
        isFullyScheduled = true;
      }
    }
  }

  return {
    epicId,
    startDate,
    endDate,
    isFullyScheduled,
    totalChildrenCount: workableChildren.length,
    scheduledChildrenCount: scheduledCount,
    unscheduledChildrenCount: workableChildren.length - scheduledCount,
    completedChildrenCount: completedCount,
    totalPoints,
    childItemIds,
    scheduledSprintIds: Array.from(scheduledSprintIds),
  };
}

/**
 * Returns all epics (or items of type 'epic') with their inferred schedules.
 */
export function getAllEpicsWithInferredSchedule(
  doc: RequirementsDocument,
  programIncrements: ProgramIncrement[],
  milestones: Milestone[] = []
): Array<{ epic: RequirementItem; schedule: EpicInferredSchedule }> {
  return doc.items
    .filter((item) => item.typeId === "epic" || item.typeId.toLowerCase().includes("epic"))
    .map((epic) => ({
      epic,
      schedule: computeEpicInferredSchedule(epic.id, doc, programIncrements, milestones),
    }));
}
