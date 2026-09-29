import { useMemo } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { Sprint } from '../../domain/timeline/programIncrements';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import type { Milestone } from '../../domain/timeline/milestones';
import { computeSprintMilestoneSummary } from '../../domain/timeline/sprintSummaries';

interface SprintRowProps {
  sprint: Sprint;
  range: { startDate: string; endDate: string } | undefined;
  itemCount: number;
  milestones?: Milestone[];
  requirements: RequirementsDocument;
  isFirst: boolean;
  isLast: boolean;
  onUpdateName: (name: string) => void;
  onUpdateEnd: (endDate: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/**
 * One sprint in a PI's sprint list: name, dates, reorder and delete.
 *
 * Moved unchanged from TimelineView.tsx. Not memoized, as before: it
 * re-renders with its parent exactly as it did when it lived there.
 */
export function SprintRow({
  sprint,
  range,
  itemCount,
  milestones = [],
  requirements,
  isFirst,
  isLast,
  onUpdateName,
  onUpdateEnd,
  onDelete,
  onMoveUp,
  onMoveDown,
}: SprintRowProps) {
  const sprintSummary = useMemo(() => {
    return computeSprintMilestoneSummary(sprint, range, milestones, requirements);
  }, [sprint, range, milestones, requirements]);

  return (
    <div className="sprint-row">
      <div className="sprint-row__reorder">
        <button
          type="button"
          disabled={isFirst}
          onClick={onMoveUp}
          aria-label="Move sprint earlier"
        >
          <ChevronUp size={12} />
        </button>
        <button type="button" disabled={isLast} onClick={onMoveDown} aria-label="Move sprint later">
          <ChevronDown size={12} />
        </button>
      </div>
      <input
        className="sprint-row__name"
        value={sprint.name}
        onChange={(e) => onUpdateName(e.target.value)}
      />
      <span
        className="sprint-row__start"
        title="Computed automatically from this PI's start date and every earlier sprint's length"
      >
        {range?.startDate ?? '—'}
      </span>
      <span className="sprint-row__arrow">→</span>
      <input
        type="date"
        className="sprint-row__end"
        value={range?.endDate ?? ''}
        onChange={(e) => onUpdateEnd(e.target.value)}
      />
      <span className="sprint-row__duration">{sprint.durationDays}d</span>
      {sprintSummary.directMilestones.length > 0 && (
        <span
          className="sprint-row__milestone-badge"
          title={`${sprintSummary.directMilestones.length} milestone(s) in sprint: ${sprintSummary.directMilestones.map((m) => m.name).join(', ')}`}
        >
          ◆ {sprintSummary.directMilestones.length}
        </span>
      )}
      {sprintSummary.impactedReleases.length > 0 && (
        <span
          className="sprint-row__release-badge"
          title={`Impacts ${sprintSummary.impactedReleases.length} release(s): ${sprintSummary.impactedReleases.map((r) => r.milestone.name).join(', ')}`}
        >
          📦 {sprintSummary.impactedReleases.length}
        </span>
      )}
      {sprintSummary.impactedEpics.length > 0 && (
        <span
          className="sprint-row__epic-badge"
          title={`Contains work for ${sprintSummary.impactedEpics.length} epic(s): ${sprintSummary.impactedEpics.map((e) => `${e.epic.id} (${e.completedChildrenCount}/${e.totalChildrenCount})`).join(', ')}`}
        >
          ⚡ {sprintSummary.impactedEpics.length}
        </span>
      )}
      {itemCount > 0 && (
        <span
          className="sprint-row__item-count"
          title={`${itemCount} requirement item${itemCount === 1 ? '' : 's'} assigned`}
        >
          {itemCount}
        </span>
      )}
      <button
        type="button"
        className="sprint-row__delete"
        onClick={onDelete}
        aria-label={`Delete ${sprint.name}`}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
