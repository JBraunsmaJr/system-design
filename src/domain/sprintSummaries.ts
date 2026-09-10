import type { RequirementsDocument, RequirementItem } from "./requirementsTypes.ts";
import type { Sprint, SprintDateRange, ProgramIncrement } from "./programIncrements.ts";
import type { Milestone } from "./milestones.ts";
import { getMilestoneItems } from "./milestones.ts";
import { isItemWorkable } from "./requirementsRegistry.ts";
import { getChildItemsForParent } from "./epicScheduling.ts";

export interface ImpactedReleaseInfo {
  milestone: Milestone;
  relatedItemsInSprint: RequirementItem[];
  totalRelatedItemsCount: number;
  scheduledRelatedItemsCount: number;
  completedRelatedItemsCount: number;
  isFullyContainedInSprint: boolean;
  completionPercentage: number;
}

export interface ImpactedEpicInfo {
  epic: RequirementItem;
  itemsInSprint: RequirementItem[];
  totalChildrenCount: number;
  scheduledChildrenCount: number;
  completedChildrenCount: number;
  completionPercentage: number;
}

export interface SprintMilestoneSummary {
  sprintId: string;
  sprintName?: string;
  startDate: string;
  endDate: string;
  /** Milestones whose scheduledAt falls within [startDate, endDate] */
  directMilestones: Milestone[];
  /** Releases/Milestones impacted by items assigned to this sprint */
  impactedReleases: ImpactedReleaseInfo[];
  /** Epics whose child items are assigned to this sprint */
  impactedEpics: ImpactedEpicInfo[];
  /** External non-workable dependencies affecting items in this sprint */
  externalDependencies: RequirementItem[];
  /** Total count of distinct direct and impacted milestones */
  totalMilestoneCount: number;
}

/**
 * Computes the sprint-level milestone and release summary for a given sprint.
 * Pure projection that does not affect team capacity or sprint story points (FR-007, FR-008, DR-001, DR-006).
 */
export function computeSprintMilestoneSummary(
  sprint: Sprint,
  sprintRange: { startDate: string; endDate: string } | undefined,
  milestones: Milestone[] = [],
  requirementsDoc: RequirementsDocument
): SprintMilestoneSummary {
  const startDate = sprintRange?.startDate ?? "";
  const endDate = sprintRange?.endDate ?? "";

  // 1. Direct milestones occurring within sprint date window
  const directMilestones = startDate && endDate
    ? milestones.filter((m) => m.scheduledAt >= startDate && m.scheduledAt <= endDate)
    : [];

  // 2. Items assigned to this sprint
  const itemsInSprint = requirementsDoc.items.filter((item) => item.sprintId === sprint.id);
  const itemsInSprintIds = new Set(itemsInSprint.map((item) => item.id));

  // 3. Impacted releases / milestones associated with work in this sprint
  const impactedReleases: ImpactedReleaseInfo[] = [];
  const impactedMilestoneIds = new Set<string>();

  for (const milestone of milestones) {
    const allRelatedItems = getMilestoneItems(milestone, requirementsDoc);
    if (allRelatedItems.length === 0) continue;

    const relatedInSprint = allRelatedItems.filter((item) => itemsInSprintIds.has(item.id));
    if (relatedInSprint.length > 0) {
      impactedMilestoneIds.add(milestone.id);
      const totalCount = allRelatedItems.length;
      const scheduledCount = allRelatedItems.filter((i) => !!i.sprintId).length;
      const completedCount = allRelatedItems.filter((i) => i.status === "done").length;
      const isFullyContainedInSprint = totalCount > 0 && relatedInSprint.length === totalCount;
      const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      impactedReleases.push({
        milestone,
        relatedItemsInSprint: relatedInSprint,
        totalRelatedItemsCount: totalCount,
        scheduledRelatedItemsCount: scheduledCount,
        completedRelatedItemsCount: completedCount,
        isFullyContainedInSprint,
        completionPercentage,
      });
    }
  }

  // 4. External dependencies affecting items in this sprint (e.g. DEP-1 items)
  const externalDepIds = new Set<string>();
  for (const rel of requirementsDoc.relationships) {
    if (itemsInSprintIds.has(rel.fromItemId) && rel.typeId === "depends-on") {
      externalDepIds.add(rel.toItemId);
    }
  }

  const externalDependencies = requirementsDoc.items.filter((item) => externalDepIds.has(item.id));

  // 5. Epics whose workable child items are assigned to this sprint
  const impactedEpics: ImpactedEpicInfo[] = [];
  const epics = requirementsDoc.items.filter(
    (item) => item.typeId === "epic" || item.typeId.toLowerCase().includes("epic")
  );

  for (const epic of epics) {
    const children = getChildItemsForParent(epic.id, requirementsDoc);
    const workableChildren = children.filter((c) => isItemWorkable(requirementsDoc, c));
    const itemsInSprintForEpic = workableChildren.filter((c) => itemsInSprintIds.has(c.id));

    if (itemsInSprintForEpic.length > 0) {
      const totalCount = workableChildren.length;
      const scheduledCount = workableChildren.filter((c) => !!c.sprintId).length;
      const completedCount = workableChildren.filter((c) => c.status === "done").length;
      const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      impactedEpics.push({
        epic,
        itemsInSprint: itemsInSprintForEpic,
        totalChildrenCount: totalCount,
        scheduledChildrenCount: scheduledCount,
        completedChildrenCount: completedCount,
        completionPercentage,
      });
    }
  }

  // 6. Total distinct milestones
  const distinctMilestoneIds = new Set([
    ...directMilestones.map((m) => m.id),
    ...impactedMilestoneIds,
  ]);

  return {
    sprintId: sprint.id,
    sprintName: sprint.name,
    startDate,
    endDate,
    directMilestones,
    impactedReleases,
    impactedEpics,
    externalDependencies,
    totalMilestoneCount: distinctMilestoneIds.size,
  };
}

/**
 * Computes sprint milestone summaries for all sprints in a Program Increment.
 */
export function computePIMilestoneSummaries(
  pi: ProgramIncrement,
  sprintRanges: SprintDateRange[],
  milestones: Milestone[] = [],
  requirementsDoc: RequirementsDocument
): Map<string, SprintMilestoneSummary> {
  const rangeMap = new Map(sprintRanges.map((r) => [r.sprintId, r]));
  const summaryMap = new Map<string, SprintMilestoneSummary>();

  for (const sprint of pi.sprints) {
    const range = rangeMap.get(sprint.id);
    const summary = computeSprintMilestoneSummary(sprint, range, milestones, requirementsDoc);
    summaryMap.set(sprint.id, summary);
  }

  return summaryMap;
}
