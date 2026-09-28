import { useMemo } from 'react';
import type { ProgramIncrement, Sprint } from '../../../domain/timeline/programIncrements';
import type { TeamDocument, SprintCapacitySummary } from '../../../domain/timeline/teamTypes';
import type { RequirementsDocument } from '../../../domain/requirements/requirementsTypes';
import {
  computePICapacities,
  computeSprintCapacity,
} from '../../../domain/timeline/teamCapacity';
import {
  computeSprintDateRanges,
  getSprintActiveReservations,
} from '../../../domain/timeline/programIncrements';
import { isItemWorkable } from '../../../domain/requirements/requirementsRegistry';

export function useTimelineCapacity(
  pi: ProgramIncrement | undefined,
  team: TeamDocument | undefined,
  requirements: RequirementsDocument,
) {
  const sprintDateRanges = useMemo(() => {
    if (!pi) return [];
    return computeSprintDateRanges(pi);
  }, [pi]);

  const piCapacities = useMemo(() => {
    if (!pi || !team) return null;
    const workableItems = requirements.items.filter((i) => isItemWorkable(requirements, i));
    return computePICapacities(pi, sprintDateRanges, team, workableItems);
  }, [pi, sprintDateRanges, team, requirements]);

  const sprintRangesById = useMemo(() => {
    return new Map(sprintDateRanges.map((r) => [r.sprintId, r]));
  }, [sprintDateRanges]);

  const getSprintCapacity = (sprint: Sprint): SprintCapacitySummary | null => {
    if (!team) return null;
    const range = sprintRangesById.get(sprint.id);
    const workableItems = requirements.items.filter(
      (item) => item.sprintId === sprint.id && isItemWorkable(requirements, item),
    );
    const activeReservations = getSprintActiveReservations(pi?.reservations, sprint.id);
    return computeSprintCapacity(sprint, range, team, workableItems, activeReservations);
  };

  return {
    piCapacities,
    sprintDateRanges,
    sprintRangesById,
    getSprintCapacity,
  };
}
