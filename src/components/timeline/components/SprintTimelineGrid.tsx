import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type {
  CapacityReservation,
  ProgramIncrement,
  Sprint,
} from '../../../domain/timeline/programIncrements';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../../domain/requirements/requirementsTypes';
import type { Milestone } from '../../../domain/timeline/milestones';
import type { TeamDocument } from '../../../domain/timeline/teamTypes';
import type { ProgramIncrementsStore } from '../../../collab/stores/programIncrementsStore';
import type { ScheduleConflictSeverity } from '../../../domain/timeline/scheduleConflicts';
import {
  computeSprintDateRanges,
  getSprintActiveReservations,
} from '../../../domain/timeline/programIncrements';
import {
  computeSprintMilestoneSummary,
} from '../../../domain/timeline/sprintSummaries';
import {
  computePICapacities,
  computeSprintCapacity,
} from '../../../domain/timeline/teamCapacity';
import { getItemType, isItemWorkable } from '../../../domain/requirements/requirementsRegistry';
import { checkScheduleConflict } from '../../../domain/timeline/scheduleConflicts';
import { SprintCapacityBar } from '../../team/SprintCapacityBar';
import { MemberPicker } from '../../team/MemberPicker';
import { PointsPicker } from '../../team/PointsPicker';
import { ManageReservationsModal } from '../ManageReservationsModal';
import { SprintRow } from './SprintRow';

export interface SprintBoardColumnProps {
  sprint: Sprint;
  range?: { startDate: string; endDate: string };
  items: RequirementItem[];
  requirements: RequirementsDocument;
  milestones?: Milestone[];
  team?: TeamDocument;
  backlogItems?: RequirementItem[];
  conflictSeverityByItemId: Map<
    string,
    { severity: ScheduleConflictSeverity; blocker: RequirementItem }
  >;
  draggedItemId: string | null;
  blockingItemIds: Set<string>;
  sprintRangesByItemId: Map<string, { startDate: string; endDate: string }>;
  reservations?: CapacityReservation[];
  parentEpicByItemId?: Map<string, RequirementItem>;
  filteredChildItemIds?: Set<string> | null;
  onSelectItem: (id: string) => void;
  onSelectMilestone?: (id: string) => void;
  onDragStartItem: (id: string) => void;
  onDragEndItem: () => void;
  onDropItem: (itemId: string, sprintId: string) => string | null;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
}

export function SprintBoardColumn({
  sprint,
  range,
  items,
  requirements,
  milestones,
  team,
  conflictSeverityByItemId,
  draggedItemId,
  blockingItemIds,
  sprintRangesByItemId,
  reservations,
  parentEpicByItemId,
  filteredChildItemIds,
  onSelectItem,
  onSelectMilestone,
  onDragStartItem,
  onDragEndItem,
  onDropItem,
  onUpdateItem,
}: SprintBoardColumnProps) {
  const [internalIsDragOver, setIsDragOver] = useState(false);
  const isDragOver = Boolean(draggedItemId) && internalIsDragOver;
  const dragCounter = useRef(0);
  const [dropError, setDropError] = useState<string | null>(null);
  const dropErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sprintSummary = useMemo(() => {
    return computeSprintMilestoneSummary(sprint, range, milestones, requirements);
  }, [sprint, range, milestones, requirements]);

  const activeSprintReservations = getSprintActiveReservations(reservations, sprint.id);

  const capacitySummary = team
    ? computeSprintCapacity(
        sprint,
        range,
        team,
        requirements.items.filter((i) => isItemWorkable(requirements, i)),
        activeSprintReservations,
      )
    : null;

  const dropConflict = useMemo(() => {
    if (!draggedItemId || !range) return null;
    return checkScheduleConflict(
      draggedItemId,
      sprint.id,
      range,
      requirements.items,
      requirements.relationships,
      requirements.relationshipTypes,
      requirements.itemTypes,
      sprintRangesByItemId,
    );
  }, [draggedItemId, range, sprint.id, requirements, sprintRangesByItemId]);

  const isBlocked = dropConflict?.severity === 'blocked';
  const isAtRisk = dropConflict?.severity === 'risk';

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = isBlocked ? 'none' : 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    onDragEndItem();
    const itemId = e.dataTransfer.getData('text/plain') || draggedItemId;
    if (itemId) {
      const err = onDropItem(itemId, sprint.id);
      if (err) {
        setDropError(err);
        if (dropErrorTimer.current) clearTimeout(dropErrorTimer.current);
        dropErrorTimer.current = setTimeout(() => setDropError(null), 4000);
      } else {
        setDropError(null);
      }
    }
  };

  const visibleItems = useMemo(() => {
    if (!filteredChildItemIds) return items;
    return items.filter((item) => filteredChildItemIds.has(item.id));
  }, [items, filteredChildItemIds]);

  return (
    <div
      className={`pi-board-column${isDragOver ? ' is-drag-over' : ''}${isBlocked ? ' is-drop-blocked' : ''}${isAtRisk ? ' is-drop-risk' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="pi-board-column__header">
        <span className="pi-board-column__name">{sprint.name}</span>
        <span className="pi-board-column__count">{visibleItems.length}</span>
      </div>
      {range && (
        <div className="pi-board-column__dates">
          {range.startDate} → {range.endDate}
        </div>
      )}

      {capacitySummary && <SprintCapacityBar summary={capacitySummary} compact={true} />}

      {(sprintSummary.directMilestones.length > 0 ||
        sprintSummary.impactedReleases.length > 0 ||
        sprintSummary.impactedEpics.length > 0) && (
        <div className="pi-board-column__milestones-strip">
          {sprintSummary.directMilestones.length > 0 && (
            <div className="pi-board-column__milestones-group">
              {sprintSummary.directMilestones.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="pi-board-column__milestone-pill is-direct"
                  onClick={() => onSelectMilestone?.(m.id)}
                  title={`Marker in this sprint: ${m.name} (${m.scheduledAt})`}
                >
                  <span className="pi-board-column__milestone-pill-icon">◆</span>
                  <span className="pi-board-column__milestone-pill-name">{m.name}</span>
                </button>
              ))}
            </div>
          )}

          {sprintSummary.impactedReleases.length > 0 && (
            <div className="pi-board-column__milestones-group">
              {sprintSummary.impactedReleases.map((release) => (
                <button
                  key={release.milestone.id}
                  type="button"
                  className="pi-board-column__milestone-pill is-impacted"
                  onClick={() => onSelectMilestone?.(release.milestone.id)}
                  title={`Work in this sprint contributes to Release: ${release.milestone.name} (${release.completedRelatedItemsCount}/${release.totalRelatedItemsCount} items completed)`}
                >
                  <span className="pi-board-column__milestone-pill-icon">📦</span>
                  <span className="pi-board-column__milestone-pill-name">
                    {release.milestone.name}
                  </span>
                  <span className="pi-board-column__milestone-pill-badge">
                    {release.completedRelatedItemsCount}/{release.totalRelatedItemsCount}
                  </span>
                </button>
              ))}
            </div>
          )}

          {sprintSummary.impactedEpics.length > 0 && (
            <div className="pi-board-column__epic-progress-list">
              {sprintSummary.impactedEpics.map((epicInfo) => {
                const isComplete =
                  epicInfo.totalChildrenCount > 0 &&
                  epicInfo.completedChildrenCount === epicInfo.totalChildrenCount;
                return (
                  <div
                    key={epicInfo.epic.id}
                    className={`pi-board-column__epic-progress-card${isComplete ? ' is-complete' : ''}`}
                    onClick={() => onSelectItem(epicInfo.epic.id)}
                    title={`Epic: ${epicInfo.epic.id} - ${epicInfo.epic.title || 'Untitled'}\n${epicInfo.completedChildrenCount}/${epicInfo.totalChildrenCount} completed (${epicInfo.completionPercentage}%)\n${epicInfo.itemsInSprint.length} item(s) in this sprint`}
                  >
                    <div className="pi-board-column__epic-progress-header">
                      <span className="pi-board-column__epic-progress-title">
                        <span style={{ color: '#a78bfa' }}>⚡</span>
                        <span>{epicInfo.epic.id}</span>
                        {epicInfo.epic.title && (
                          <span className="pi-board-column__epic-progress-name">
                            {epicInfo.epic.title}
                          </span>
                        )}
                      </span>
                      <span className="pi-board-column__epic-progress-metrics">
                        {epicInfo.completedChildrenCount}/{epicInfo.totalChildrenCount} (
                        {epicInfo.completionPercentage}%)
                      </span>
                    </div>
                    <div className="pi-board-column__epic-progress-bar-bg">
                      <div
                        className="pi-board-column__epic-progress-bar-fill"
                        style={{ width: `${Math.max(epicInfo.completionPercentage, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {dropConflict && (
        <div
          className={`pi-board-column__blocked-banner${isAtRisk ? ' is-risk' : ''}`}
          title={
            isAtRisk
              ? `Same sprint as its blocker ${dropConflict.blocker.id}${dropConflict.blocker.title ? ` (${dropConflict.blocker.title})` : ''} - allowed, but make sure ${dropConflict.blocker.id} is done first.`
              : dropConflict.blockerRange
                ? `Can't schedule here - blocked by ${dropConflict.blocker.id}${dropConflict.blocker.title ? ` (${dropConflict.blocker.title})` : ''}, which isn't finished until ${dropConflict.blockerRange.endDate}.`
                : `Can't schedule here - blocked by ${dropConflict.blocker.id}${dropConflict.blocker.title ? ` (${dropConflict.blocker.title})` : ''}, which isn't scheduled yet.`
          }
        >
          <AlertTriangle size={12} className="pi-board-column__blocked-icon" />
          <span className="pi-board-column__blocked-text">
            {isAtRisk
              ? `Same sprint as blocker ${dropConflict.blocker.id} - do that first`
              : dropConflict.blockerRange
                ? `Blocked by ${dropConflict.blocker.id} (ends ${dropConflict.blockerRange.endDate})`
                : `Blocked by ${dropConflict.blocker.id} (unscheduled)`}
          </span>
        </div>
      )}
      {dropError && <p className="pi-board-column__drop-error">{dropError}</p>}
      <div className="pi-board-column__items">
        {visibleItems.length === 0 ? (
          <div className="pi-board-column__empty">
            {isBlocked
              ? `Cannot add: blocked by ${dropConflict?.blocker.id}`
              : isDragOver
                ? 'Drop to assign to sprint'
                : 'No requirements assigned'}
          </div>
        ) : (
          visibleItems.map((item) => {
            const type = getItemType(requirements, item.typeId);
            const category = item.categoryId
              ? requirements.categories.find((c) => c.id === item.categoryId)
              : undefined;
            const isDragging = draggedItemId === item.id;
            const conflictInfo = conflictSeverityByItemId.get(item.id);
            const isConflicted = conflictInfo?.severity === 'blocked';
            const isAtRisk = conflictInfo?.severity === 'risk';
            const isBlocker = blockingItemIds.has(item.id);
            const parentEpic = parentEpicByItemId?.get(item.id);
            return (
              <div
                key={item.id}
                className={`pi-board-item${isDragging ? ' is-dragging' : ''}${isConflicted ? ' is-conflicted' : ''}${isAtRisk ? ' is-at-risk' : ''}${isBlocker ? ' is-blocker-highlight' : ''}`}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', item.id);
                  e.dataTransfer.effectAllowed = 'move';
                  requestAnimationFrame(() => {
                    onDragStartItem(item.id);
                  });
                }}
                onDragEnd={() => {
                  onDragEndItem();
                }}
                onClick={() => onSelectItem(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectItem(item.id);
                  }
                }}
                title={`Click to view description • Drag to move to another sprint`}
              >
                <div className="pi-board-item__header">
                  <span
                    className="pi-board-item__id"
                    style={{
                      color: type?.color ?? 'var(--chrome-text-dim)',
                      borderColor: `${type?.color ?? 'var(--chrome-border)'}66`,
                    }}
                  >
                    {item.id}
                  </span>
                  {parentEpic && (
                    <span
                      className="pi-board-item__epic-badge"
                      title={`Epic: ${parentEpic.id} ${parentEpic.title || ''}`}
                    >
                      {parentEpic.id}
                    </span>
                  )}
                  {isBlocker && (
                    <span
                      className="pi-board-item__blocker-badge"
                      title="Blocks the item currently being dragged"
                    >
                      Blocker
                    </span>
                  )}
                  {isConflicted && (
                    <AlertTriangle
                      size={12}
                      className="pi-board-item__conflict-warning"
                      aria-label={`Blocked by ${conflictInfo?.blocker.id}${conflictInfo?.blocker.title ? ` (${conflictInfo.blocker.title})` : ''} - move this or its blocker to a different sprint to resolve`}
                    />
                  )}
                  {isAtRisk && (
                    <AlertTriangle
                      size={12}
                      className="pi-board-item__risk-warning"
                      aria-label={`Same sprint as its blocker ${conflictInfo?.blocker.id}${conflictInfo?.blocker.title ? ` (${conflictInfo.blocker.title})` : ''} - make sure that's done first`}
                    />
                  )}
                  {category && (
                    <span
                      className="pi-board-item__category"
                      style={{
                        color: category.color,
                        borderColor: `${category.color}44`,
                        background: `${category.color}18`,
                      }}
                    >
                      {category.label}
                    </span>
                  )}
                </div>
                <div className="pi-board-item__title">{item.title || 'Untitled'}</div>
                <div className="pi-board-item__footer">
                  {team && isItemWorkable(requirements, item) && (
                    <MemberPicker
                      team={team}
                      assigneeId={item.assigneeId}
                      compact={true}
                      onAssign={(assigneeId) => onUpdateItem(item.id, { assigneeId })}
                      onClear={() => onUpdateItem(item.id, { assigneeId: undefined })}
                    />
                  )}
                  {isItemWorkable(requirements, item) && (
                    <PointsPicker
                      points={item.points}
                      compact={true}
                      onChange={(points) => onUpdateItem(item.id, { points })}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export interface ProgramIncrementCardProps {
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
  onDelete: () => void;
  onAddSprint: () => void;
  onUpdateSprintName: (sprintId: string, name: string) => void;
  onUpdateSprintEnd: (sprintId: string, endDate: string) => void;
  onDeleteSprint: (sprintId: string) => void;
  onMoveSprint: (sprintId: string, direction: 'up' | 'down') => void;
  programIncrementsStore: ProgramIncrementsStore;
}

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
  onDelete,
  onAddSprint,
  onUpdateSprintName,
  onUpdateSprintEnd,
  onDeleteSprint,
  onMoveSprint,
  programIncrementsStore,
}: ProgramIncrementCardProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isSprintListCollapsed, setIsSprintListCollapsed] = useState(false);
  const [isManagingReservations, setIsManagingReservations] = useState(false);
  const ranges = computeSprintDateRanges(pi);
  const rangeBySprintId = new Map(ranges.map((r) => [r.sprintId, r]));

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
    for (const s of piCapacitySummaries) {
      grossCapacity += s.grossCapacityPoints;
      totalReserved += s.totalReservedPoints;
      totalCapacity += s.totalCapacityPoints;
      totalAssigned += s.totalAssignedPoints;
    }
    const remainingCapacityPoints = Math.round((totalCapacity - totalAssigned) * 10) / 10;
    const isOverCapacity = totalAssigned > totalCapacity && totalCapacity > 0;
    const percent =
      totalCapacity > 0 ? Math.round((totalAssigned / totalCapacity) * 100) : 0;
    return {
      grossCapacityPoints: Math.round(grossCapacity * 10) / 10,
      totalReservedPoints: Math.round(totalReserved * 10) / 10,
      totalCapacityPoints: Math.round(totalCapacity * 10) / 10,
      totalAssignedPoints: Math.round(totalAssigned * 10) / 10,
      remainingCapacityPoints,
      isOverCapacity,
      percent,
    };
  }, [team, piCapacitySummaries]);

  return (
    <section className="pi-card">
      <div className="pi-card__header">
        <input
          className="pi-card__name"
          value={pi.name}
          onChange={(e) => onUpdateName(e.target.value)}
        />
        <label className="pi-card__start-label">
          Starts:
          <input
            type="date"
            className="pi-card__start"
            value={pi.startDate}
            onChange={(e) => onUpdateStart(e.target.value)}
          />
        </label>
        <span className="pi-card__sprint-count">
          {pi.sprints.length} {pi.sprints.length === 1 ? 'sprint' : 'sprints'}
        </span>

        {team && piCapacityTotals && (
          <div className="pi-card__capacity-badge-wrap">
            <div
              className={`pi-card__capacity-badge${piCapacityTotals.isOverCapacity ? ' is-over' : ''}`}
              title={`Total Available Capacity: ${piCapacityTotals.totalCapacityPoints} pts (${piCapacityTotals.grossCapacityPoints} gross - ${piCapacityTotals.totalReservedPoints} reserved)\nAssigned Demand: ${piCapacityTotals.totalAssignedPoints} pts\nRemaining Net Capacity: ${piCapacityTotals.remainingCapacityPoints} pts\nUtilization: ${piCapacityTotals.percent}%`}
            >
              <span className="pi-card__cap-label">Capacity:</span>
              <span className="pi-card__cap-val">
                {piCapacityTotals.totalAssignedPoints} / {piCapacityTotals.totalCapacityPoints} pts
              </span>
              <span className="pi-card__cap-util">({piCapacityTotals.percent}%)</span>
            </div>
            {piCapacityTotals.totalCapacityPoints > 0 && (
              <div
                className="pi-card__cap-progress-wrap"
                title={`${piCapacityTotals.percent}% committed (${piCapacityTotals.remainingCapacityPoints} pts available)`}
              >
                <div className="pi-card__cap-progress-bar">
                  <div
                    className={`pi-card__cap-progress-fill${
                      piCapacityTotals.isOverCapacity
                        ? ' is-danger'
                        : piCapacityTotals.percent >= 90
                          ? ' is-warning'
                          : ' is-normal'
                    }`}
                    style={{ width: `${Math.min(100, piCapacityTotals.percent)}%` }}
                  />
                </div>
                <span
                  className={`pi-card__cap-progress-text${piCapacityTotals.isOverCapacity ? ' is-danger' : ''}`}
                >
                  {piCapacityTotals.isOverCapacity
                    ? `+${Math.abs(piCapacityTotals.remainingCapacityPoints)} over`
                    : `${piCapacityTotals.remainingCapacityPoints} left`}
                </span>
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

      <button
        type="button"
        className="pi-card__sprints-toggle"
        onClick={() => setIsSprintListCollapsed(!isSprintListCollapsed)}
      >
        {isSprintListCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        Edit sprint dates
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
          </div>
          <div className="pi-card__board-columns">
            {pi.sprints.map((sprint) => (
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
