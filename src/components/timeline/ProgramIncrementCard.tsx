import { useMemo, useState } from 'react';
import { CalendarRange, ChevronDown, ChevronRight, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import {
  computeSprintDateRanges,
  type PlanningDetailsPatch,
  type ProgramIncrement,
} from '../../domain/timeline/programIncrements';
import { isItemWorkable } from '../../domain/requirements/requirementsRegistry';
import type { ScheduleConflictSeverity } from '../../domain/timeline/scheduleConflicts';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import type { ProgramIncrementsStore } from '../../collab/stores/programIncrementsStore';
import type { Milestone } from '../../domain/timeline/milestones';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import { computePICapacities } from '../../domain/timeline/teamCapacity';
import { ManageReservationsModal } from './ManageReservationsModal';
import { SprintRow } from './SprintRow';
import { SprintBoardColumn } from './SprintBoardColumn';
import { PlanningDetailsFields } from './PlanningDetailsFields';

interface ProgramIncrementCardProps {
  pi: ProgramIncrement;
  requirements: RequirementsDocument;
  milestones?: Milestone[];
  team?: TeamDocument;
  itemsBySprintId: Map<string, RequirementItem[]>;
  backlogItems: RequirementItem[];
  conflictSeverityByItemId: Map<
    string,
    { severity: ScheduleConflictSeverity; blocker: RequirementItem }
  >;
  draggedItemId: string | null;
  blockingItemIds: Set<string>;
  sprintRangesByItemId: Map<string, { startDate: string; endDate: string }>;
  parentEpicByItemId?: Map<string, RequirementItem>;
  filteredChildItemIds?: Set<string> | null;
  onSelectItem: (itemId: string) => void;
  onSelectMilestone?: (id: string) => void;
  onDragStartItem: (itemId: string) => void;
  onDragEndItem: () => void;
  onDropItem: (itemId: string, sprintId: string) => string | null;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  onUpdateName: (name: string) => void;
  onUpdateStart: (startDate: string) => void;
  onUpdateDetails: (patch: PlanningDetailsPatch) => void;
  onDelete: () => void;
  onAddSprint: () => void;
  onUpdateSprintName: (sprintId: string, name: string) => void;
  onUpdateSprintEnd: (sprintId: string, endDate: string) => void;
  onUpdateSprintDetails: (sprintId: string, patch: PlanningDetailsPatch) => void;
  onDeleteSprint: (sprintId: string) => void;
  onMoveSprint: (sprintId: string, direction: 'up' | 'down') => void;
  programIncrementsStore: ProgramIncrementsStore;
  /** The sprint columns to show on the board, or null/undefined for all -
   * see boardFilter.ts. Only the board is narrowed: the sprint list under
   * "Edit sprints" and the PI's capacity totals always cover every sprint. */
  visibleSprintIds?: Set<string> | null;
}

/**
 * One Program Increment: its sprints, capacity and reservations.
 *
 * Moved unchanged from TimelineView.tsx. Not memoized, as before: it
 * re-renders with its parent exactly as it did when it lived there.
 */
export function ProgramIncrementCard({
  pi,
  requirements,
  milestones,
  team,
  itemsBySprintId,
  backlogItems,
  conflictSeverityByItemId,
  draggedItemId,
  blockingItemIds,
  sprintRangesByItemId,
  parentEpicByItemId,
  filteredChildItemIds,
  onSelectItem,
  onSelectMilestone,
  onDragStartItem,
  onDragEndItem,
  onDropItem,
  onUpdateItem,
  onUpdateName,
  onUpdateStart,
  onUpdateDetails,
  onDelete,
  onAddSprint,
  onUpdateSprintName,
  onUpdateSprintEnd,
  onUpdateSprintDetails,
  onDeleteSprint,
  onMoveSprint,
  programIncrementsStore,
  visibleSprintIds,
}: ProgramIncrementCardProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  // Folded by default: sprint names and dates are set up once per PI, and
  // open they push the board itself most of a screen down the page.
  const [isSprintListCollapsed, setIsSprintListCollapsed] = useState(true);
  const [isManagingReservations, setIsManagingReservations] = useState(false);
  const ranges = computeSprintDateRanges(pi);
  const rangeBySprintId = new Map(ranges.map((r) => [r.sprintId, r]));
  const boardSprints = visibleSprintIds
    ? pi.sprints.filter((s) => visibleSprintIds.has(s.id))
    : pi.sprints;

  const reservationsCount = pi.reservations?.length ?? 0;

  const piCapacitySummaries = useMemo(() => {
    if (!team) return [];
    const workableItems = requirements.items.filter((i) => isItemWorkable(requirements, i));
    return computePICapacities(pi, ranges, team, workableItems);
  }, [pi, ranges, team, requirements]);

  const piCapacityTotals = useMemo(() => {
    if (!team || piCapacitySummaries.length === 0) return null;
    let grossCapacity = 0;
    let totalReserved = 0;
    let totalCapacity = 0;
    let totalAssigned = 0;
    let totalRemaining = 0;

    for (const s of piCapacitySummaries) {
      grossCapacity += s.grossCapacityPoints;
      totalReserved += s.totalReservedPoints;
      totalCapacity += s.totalCapacityPoints;
      totalAssigned += s.totalAssignedPoints;
      totalRemaining += s.remainingCapacityPoints;
    }

    grossCapacity = Math.round(grossCapacity * 10) / 10;
    totalReserved = Math.round(totalReserved * 10) / 10;
    totalCapacity = Math.round(totalCapacity * 10) / 10;
    totalAssigned = Math.round(totalAssigned * 10) / 10;
    totalRemaining = Math.round(totalRemaining * 10) / 10;

    const hasCapacity = totalCapacity > 0;
    const percent = hasCapacity ? Math.round((totalAssigned / totalCapacity) * 100) : 0;
    const isOverCapacity = totalAssigned > totalCapacity && hasCapacity;

    return {
      grossCapacityPoints: grossCapacity,
      totalReservedPoints: totalReserved,
      totalCapacityPoints: totalCapacity,
      totalAssignedPoints: totalAssigned,
      remainingCapacityPoints: totalRemaining,
      percent,
      isOverCapacity,
      hasCapacity,
    };
  }, [team, piCapacitySummaries]);

  return (
    <section className="pi-card">
      <div className="pi-card__header">
        <CalendarRange size={16} className="pi-card__icon" />
        <input
          className="pi-card__name"
          value={pi.name}
          onChange={(e) => onUpdateName(e.target.value)}
        />
        <label className="pi-card__start-label">
          Starts
          <input
            type="date"
            className="pi-card__start-input"
            value={pi.startDate}
            onChange={(e) => onUpdateStart(e.target.value)}
          />
        </label>

        {team && piCapacityTotals && (
          // One line and one bar for the whole PI: what is planned against
          // what the team can take on once reservations are set aside.
          <div
            className="pi-card__capacity"
            title={`${piCapacityTotals.totalAssignedPoints} pts planned of ${piCapacityTotals.totalCapacityPoints} available (${piCapacityTotals.grossCapacityPoints} gross, ${piCapacityTotals.totalReservedPoints} reserved)`}
          >
            <div className="pi-card__capacity-line">
              <span className="pi-card__capacity-planned">
                <strong>{piCapacityTotals.totalAssignedPoints}</strong> of{' '}
                {piCapacityTotals.totalCapacityPoints} pts planned
              </span>
              {piCapacityTotals.totalReservedPoints > 0 && (
                <span className="pi-card__capacity-reserved">
                  <ShieldAlert size={11} />
                  {piCapacityTotals.totalReservedPoints} reserved
                </span>
              )}
              {piCapacityTotals.hasCapacity && (
                <span
                  className={`pi-card__capacity-left${piCapacityTotals.isOverCapacity ? ' is-danger' : ''}`}
                >
                  {piCapacityTotals.isOverCapacity
                    ? `${Math.abs(piCapacityTotals.remainingCapacityPoints)} over`
                    : `${piCapacityTotals.remainingCapacityPoints} left`}
                </span>
              )}
            </div>
            {piCapacityTotals.hasCapacity && (
              <div className="pi-card__capacity-bar">
                <div
                  className={`pi-card__capacity-fill${
                    piCapacityTotals.isOverCapacity
                      ? ' is-danger'
                      : piCapacityTotals.percent >= 90
                        ? ' is-warning'
                        : ' is-normal'
                  }`}
                  style={{ width: `${Math.min(100, piCapacityTotals.percent)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {team && (
          <button
            type="button"
            className={`pi-card__reserve-btn${reservationsCount > 0 ? ' has-reservations' : ''}`}
            onClick={() => setIsManagingReservations(true)}
            title="Manage Capacity Reservations for this PI"
          >
            <ShieldAlert size={13} />
            <span>Reserve Capacity{reservationsCount > 0 ? ` (${reservationsCount})` : ''}</span>
          </button>
        )}

        {isConfirmingDelete ? (
          <span className="pi-card__confirm-delete">
            Delete this PI and all its sprints?
            <button type="button" className="pi-card__confirm-yes" onClick={onDelete}>
              Yes
            </button>
            <button
              type="button"
              className="pi-card__confirm-no"
              onClick={() => setIsConfirmingDelete(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="pi-card__delete"
            onClick={() => setIsConfirmingDelete(true)}
            aria-label={`Delete ${pi.name}`}
            title={`Delete ${pi.name}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="pi-card__details">
        <PlanningDetailsFields details={pi} scope="PI" onChange={onUpdateDetails} />
      </div>

      <button
        type="button"
        className="pi-card__sprints-toggle"
        onClick={() => setIsSprintListCollapsed(!isSprintListCollapsed)}
        aria-expanded={!isSprintListCollapsed}
      >
        {isSprintListCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        Edit sprints
        <span className="pi-card__sprints-toggle-count">
          {pi.sprints.length} sprint{pi.sprints.length === 1 ? '' : 's'}
        </span>
      </button>

      {!isSprintListCollapsed && (
        <>
          <div className="pi-card__sprints">
            {pi.sprints.map((sprint, index) => (
              <SprintRow
                key={sprint.id}
                sprint={sprint}
                range={rangeBySprintId.get(sprint.id)}
                itemCount={itemsBySprintId.get(sprint.id)?.length ?? 0}
                milestones={milestones}
                requirements={requirements}
                isFirst={index === 0}
                isLast={index === pi.sprints.length - 1}
                onUpdateName={(name) => onUpdateSprintName(sprint.id, name)}
                onUpdateEnd={(endDate) => onUpdateSprintEnd(sprint.id, endDate)}
                onUpdateDetails={(patch) => onUpdateSprintDetails(sprint.id, patch)}
                onDelete={() => onDeleteSprint(sprint.id)}
                onMoveUp={() => onMoveSprint(sprint.id, 'up')}
                onMoveDown={() => onMoveSprint(sprint.id, 'down')}
              />
            ))}
          </div>

          <button type="button" className="pi-card__add-sprint" onClick={onAddSprint}>
            <Plus size={12} />
            Sprint
          </button>
        </>
      )}

      {pi.sprints.length > 0 && (
        <div className="pi-card__board">
          <div className="pi-card__board-header">
            <span className="pi-card__board-title">Sprint Timeline Board</span>
            {boardSprints.length < pi.sprints.length && (
              <span className="pi-card__board-filter-note">
                Showing {boardSprints.length} of {pi.sprints.length} sprints
              </span>
            )}
          </div>
          <div
            className={`pi-card__board-columns${
              boardSprints.length < pi.sprints.length ? ' pi-card__board-columns--filtered' : ''
            }`}
          >
            {boardSprints.map((sprint) => (
              <SprintBoardColumn
                key={sprint.id}
                sprint={sprint}
                range={rangeBySprintId.get(sprint.id)}
                items={itemsBySprintId.get(sprint.id) ?? []}
                requirements={requirements}
                milestones={milestones}
                team={team}
                backlogItems={backlogItems}
                conflictSeverityByItemId={conflictSeverityByItemId}
                draggedItemId={draggedItemId}
                blockingItemIds={blockingItemIds}
                sprintRangesByItemId={sprintRangesByItemId}
                reservations={pi.reservations}
                parentEpicByItemId={parentEpicByItemId}
                filteredChildItemIds={filteredChildItemIds}
                onSelectItem={onSelectItem}
                onSelectMilestone={onSelectMilestone}
                onDragStartItem={onDragStartItem}
                onDragEndItem={onDragEndItem}
                onDropItem={onDropItem}
                onUpdateItem={onUpdateItem}
              />
            ))}
          </div>
        </div>
      )}

      {isManagingReservations && team && (
        <ManageReservationsModal
          pi={pi}
          team={team}
          requirements={requirements}
          programIncrementsStore={programIncrementsStore}
          onClose={() => setIsManagingReservations(false)}
        />
      )}
    </section>
  );
}
