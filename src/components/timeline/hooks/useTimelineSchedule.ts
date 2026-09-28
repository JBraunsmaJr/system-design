import { useMemo } from 'react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../../domain/requirements/requirementsTypes';
import type { ProgramIncrement } from '../../../domain/timeline/programIncrements';
import type { Milestone } from '../../../domain/timeline/milestones';
import { isItemWorkable } from '../../../domain/requirements/requirementsRegistry';
import { computeSprintDateRanges } from '../../../domain/timeline/programIncrements';
import {
  getAllEpicsWithInferredSchedule,
  getChildItemsForParent,
} from '../../../domain/timeline/epicScheduling';
import {
  checkScheduleConflict,
  findBlockingItemIds,
  findScheduleConflicts,
  type ScheduleConflictSeverity,
} from '../../../domain/timeline/scheduleConflicts';

export interface UseTimelineScheduleOptions {
  requirements: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  milestones: Milestone[];
  filterEpicId: string;
  draggedItemId: string | null;
}

export function useTimelineSchedule({
  requirements,
  programIncrements,
  milestones,
  filterEpicId,
  draggedItemId,
}: UseTimelineScheduleOptions) {
  const epicsWithSchedule = useMemo(() => {
    return getAllEpicsWithInferredSchedule(requirements, programIncrements, milestones);
  }, [requirements, programIncrements, milestones]);

  const parentEpicByItemId = useMemo(() => {
    const map = new Map<string, RequirementItem>();
    const epics = requirements.items.filter(
      (i) => i.typeId === 'epic' || i.typeId.toLowerCase().includes('epic'),
    );
    const epicIds = new Set(epics.map((e) => e.id));
    for (const rel of requirements.relationships) {
      if (epicIds.has(rel.fromItemId) && rel.typeId === 'parent-of') {
        const epic = epics.find((e) => e.id === rel.fromItemId);
        if (epic) map.set(rel.toItemId, epic);
      }
    }
    return map;
  }, [requirements]);

  const filteredChildItemIds = useMemo(() => {
    if (filterEpicId === 'all') return null;
    return new Set(getChildItemsForParent(filterEpicId, requirements).map((i) => i.id));
  }, [filterEpicId, requirements]);

  const itemsBySprintId = useMemo(() => {
    const map = new Map<string, RequirementItem[]>();
    for (const item of requirements.items) {
      if (!item.sprintId) continue;
      if (!isItemWorkable(requirements, item)) continue;
      const list = map.get(item.sprintId);
      if (list) {
        list.push(item);
      } else {
        map.set(item.sprintId, [item]);
      }
    }
    return map;
  }, [requirements]);

  const backlogItems = useMemo(
    () =>
      requirements.items.filter(
        (item) => !item.sprintId && isItemWorkable(requirements, item),
      ),
    [requirements],
  );

  const { allSprintRangesById, sprintRangesByItemId, conflictSeverityByItemId } = useMemo(() => {
    const allRanges = new Map<string, { startDate: string; endDate: string }>();
    for (const pi of programIncrements) {
      for (const range of computeSprintDateRanges(pi)) {
        allRanges.set(range.sprintId, { startDate: range.startDate, endDate: range.endDate });
      }
    }
    const byItemId = new Map<string, { startDate: string; endDate: string }>();
    for (const item of requirements.items) {
      if (!item.sprintId || !isItemWorkable(requirements, item)) continue;
      const range = allRanges.get(item.sprintId);
      if (range) byItemId.set(item.id, range);
    }
    const conflicts = findScheduleConflicts(
      requirements.items,
      requirements.relationships,
      requirements.relationshipTypes,
      requirements.itemTypes,
      byItemId,
    );
    const severityById = new Map<
      string,
      { severity: ScheduleConflictSeverity; blocker: RequirementItem }
    >();
    for (const c of conflicts) {
      const existing = severityById.get(c.item.id);
      if (!existing || existing.severity !== 'blocked') {
        severityById.set(c.item.id, { severity: c.severity, blocker: c.blocker });
      }
    }
    return {
      allSprintRangesById: allRanges,
      sprintRangesByItemId: byItemId,
      conflictSeverityByItemId: severityById,
    };
  }, [programIncrements, requirements]);

  const blockingItemIds = useMemo(() => {
    if (!draggedItemId) return new Set<string>();
    return findBlockingItemIds(
      draggedItemId,
      requirements.relationships,
      requirements.relationshipTypes,
      requirements.itemTypes,
      requirements.items,
    );
  }, [
    draggedItemId,
    requirements.relationships,
    requirements.relationshipTypes,
    requirements.itemTypes,
    requirements.items,
  ]);

  const checkMoveConflict = (itemId: string, targetSprintId: string): string | null => {
    const targetRange = allSprintRangesById.get(targetSprintId);
    if (targetRange) {
      const conflict = checkScheduleConflict(
        itemId,
        targetSprintId,
        targetRange,
        requirements.items,
        requirements.relationships,
        requirements.relationshipTypes,
        requirements.itemTypes,
        sprintRangesByItemId,
      );
      if (conflict && conflict.severity === 'blocked') {
        return conflict.blockerRange
          ? `Can't schedule here - blocked by ${conflict.blocker.id}, which isn't finished until ${conflict.blockerRange.endDate}.`
          : `Can't schedule here - blocked by ${conflict.blocker.id}, which isn't scheduled yet.`;
      }
    }
    return null;
  };

  return {
    epicsWithSchedule,
    parentEpicByItemId,
    filteredChildItemIds,
    itemsBySprintId,
    backlogItems,
    allSprintRangesById,
    sprintRangesByItemId,
    conflictSeverityByItemId,
    blockingItemIds,
    checkMoveConflict,
  };
}
