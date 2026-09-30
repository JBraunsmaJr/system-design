import { useEffect, useMemo, useState, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  getSprintActiveReservations,
  type Sprint,
  type CapacityReservation,
} from '../../domain/timeline/programIncrements';
import { getItemType, isItemWorkable } from '../../domain/requirements/requirementsRegistry';
import {
  checkScheduleConflict,
  type ScheduleConflictSeverity,
} from '../../domain/timeline/scheduleConflicts';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import type { Milestone } from '../../domain/timeline/milestones';
import { getMilestoneColor, getMilestoneTypeLabel } from '../../domain/timeline/milestones';
import { computeSprintMilestoneSummary } from '../../domain/timeline/sprintSummaries';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import { computeSprintCapacity } from '../../domain/timeline/teamCapacity';
import { SprintCapacityBar } from '../team/SprintCapacityBar';
import { MemberPicker } from '../team/MemberPicker';
import { PointsPicker } from '../team/PointsPicker';
import { SprintQuickAdd } from './SprintQuickAdd';

interface SprintBoardColumnProps {
  sprint: Sprint;
  range?: { startDate: string; endDate: string };
  items: RequirementItem[];
  requirements: RequirementsDocument;
  milestones?: Milestone[];
  team?: TeamDocument;
  backlogItems: RequirementItem[];
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

/**
 * One sprint on the board: its items, capacity, and drop handling.
 *
 * Moved unchanged from TimelineView.tsx. Not memoized, as before: it
 * re-renders with its parent exactly as it did when it lived there.
 */
export function SprintBoardColumn({
  sprint,
  range,
  items,
  requirements,
  milestones,
  team,
  backlogItems,
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
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [dropError, setDropError] = useState<string | null>(null);
  const dropErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!draggedItemId) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  }, [draggedItemId]);

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
  }, [
    draggedItemId,
    sprint.id,
    range,
    requirements.items,
    requirements.relationships,
    requirements.relationshipTypes,
    requirements.itemTypes,
    sprintRangesByItemId,
  ]);

  const visibleItems = useMemo(() => {
    if (!filteredChildItemIds) return items;
    return items.filter((item) => filteredChildItemIds.has(item.id));
  }, [items, filteredChildItemIds]);

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
    if (isBlocked) {
      e.dataTransfer.dropEffect = 'none';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    onDragEndItem();
    const itemId = e.dataTransfer.getData('text/plain') || draggedItemId;
    if (itemId) {
      const error = onDropItem(itemId, sprint.id);
      if (error) {
        setDropError(error);
        if (dropErrorTimer.current) clearTimeout(dropErrorTimer.current);
        dropErrorTimer.current = setTimeout(() => setDropError(null), 4000);
      }
    }
  };

  return (
    <div
      className={`pi-board-column${isBlocked ? ' is-blocked' : ''}${isAtRisk ? ' is-at-risk' : ''}${isDragOver ? (isBlocked ? ' is-drag-over-blocked' : isAtRisk ? ' is-drag-over-risk' : ' is-drag-over') : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="pi-board-column__header">
        <div className="pi-board-column__name-row">
          <span className="pi-board-column__name">{sprint.name}</span>
          <span
            className="pi-board-column__count"
            title={`${visibleItems.length} requirement item${visibleItems.length === 1 ? '' : 's'} assigned`}
          >
            {visibleItems.length}
          </span>
          <SprintQuickAdd
            backlogItems={backlogItems}
            requirements={requirements}
            onAssign={(itemId) => onDropItem(itemId, sprint.id)}
          />
        </div>
        <div className="pi-board-column__meta">
          <span className="pi-board-column__dates">
            {range ? `${range.startDate} → ${range.endDate}` : '—'}
          </span>
          <span className="pi-board-column__duration">{sprint.durationDays}d</span>
        </div>

        {capacitySummary && <SprintCapacityBar summary={capacitySummary} compact={true} />}
      </div>
      {(sprintSummary.directMilestones.length > 0 ||
        sprintSummary.impactedReleases.length > 0 ||
        sprintSummary.impactedEpics.length > 0 ||
        sprintSummary.externalDependencies.length > 0) && (
        <div className="pi-board-column__milestones">
          {(sprintSummary.directMilestones.length > 0 ||
            sprintSummary.impactedReleases.length > 0 ||
            sprintSummary.externalDependencies.length > 0) && (
            <div className="pi-board-column__milestone-chips">
              {sprintSummary.directMilestones.map((m) => {
                const color = getMilestoneColor(m);
                const typeLabel = getMilestoneTypeLabel(m.type);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="pi-board-column__milestone-pill"
                    style={{ borderColor: color, color }}
                    onClick={() => onSelectMilestone?.(m.id)}
                    title={`${typeLabel}: ${m.name} \u2022 Scheduled: ${m.scheduledAt}`}
                  >
                    <span className="pi-board-column__milestone-shape">◆</span>
                    <span className="pi-board-column__milestone-name">{m.name}</span>
                    {m.version && (
                      <span className="pi-board-column__milestone-ver">v{m.version}</span>
                    )}
                  </button>
                );
              })}
              {sprintSummary.impactedReleases.map((rel) => {
                const mColor = getMilestoneColor(rel.milestone);
                return (
                  <button
                    key={rel.milestone.id}
                    type="button"
                    className="pi-board-column__release-pill"
                    style={{ borderColor: mColor, color: mColor }}
                    onClick={() => onSelectMilestone?.(rel.milestone.id)}
                    title={`Target Release: ${rel.milestone.name} (${rel.completedRelatedItemsCount}/${rel.totalRelatedItemsCount} completed \u2022 ${rel.relatedItemsInSprint.length} in this sprint)`}
                  >
                    <span className="pi-board-column__release-shape">📦</span>
                    <span className="pi-board-column__release-name">{rel.milestone.name}</span>
                    <span className="pi-board-column__release-progress">
                      {rel.completedRelatedItemsCount}/{rel.totalRelatedItemsCount} (
                      {rel.completionPercentage}%)
                    </span>
                  </button>
                );
              })}
              {sprintSummary.externalDependencies.map((dep) => (
                <button
                  key={dep.id}
                  type="button"
                  className="pi-board-column__dep-pill"
                  onClick={() => onSelectItem(dep.id)}
                  title={`External Dependency: ${dep.id} ${dep.title || ''}`}
                >
                  <span className="pi-board-column__dep-icon">⚡</span>
                  <span className="pi-board-column__dep-name">{dep.id}</span>
                </button>
              ))}
            </div>
          )}

          {sprintSummary.impactedEpics.length > 0 && (
            <div className="pi-board-column__epic-progress-list">
              {sprintSummary.impactedEpics.map((epicInfo) => {
                const isComplete = epicInfo.completionPercentage === 100;
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
