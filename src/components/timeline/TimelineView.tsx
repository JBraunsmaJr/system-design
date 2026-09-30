import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { GanttChartSquare, Plus, Diamond } from 'lucide-react';
import { computeSprintDateRanges } from '../../domain/timeline/programIncrements';
import { isItemWorkable } from '../../domain/requirements/requirementsRegistry';
import {
  findScheduleConflicts,
  checkScheduleConflict,
  findBlockingItemIds,
  type ScheduleConflictSeverity,
} from '../../domain/timeline/scheduleConflicts';
import type { RequirementItem } from '../../domain/requirements/requirementsTypes';
import type { RequirementsStore } from '../../collab/stores/requirementsStore';
import type { ProgramIncrementsStore } from '../../collab/stores/programIncrementsStore';
import type { MilestonesStore } from '../../collab/stores/milestonesStore';
import { createLocalMilestonesStore } from '../../collab/stores/milestonesStore';
import type { Milestone } from '../../domain/timeline/milestones';
import {
  getAllEpicsWithInferredSchedule,
  getChildItemsForParent,
} from '../../domain/timeline/epicScheduling';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import type { SubDiagram } from '../../domain/canvas/types';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { PresenceInfo } from '../../collab/sync/session';
import { RequirementDetailModal } from './RequirementDetailModal';
import { MilestoneDetailModal } from './MilestoneDetailModal';
import { AddMilestoneModal } from './AddMilestoneModal';
import { GanttChart } from './GanttChart';
import { PresenceAvatarStack } from './PresenceAvatarStack';
import { MilestonesSection } from './MilestonesSection';
import { BacklogSection } from './BacklogSection';
import { ProgramIncrementCard } from './ProgramIncrementCard';

interface TimelineViewProps {
  programIncrementsStore: ProgramIncrementsStore;
  requirementsStore: RequirementsStore;
  milestonesStore?: MilestonesStore;
  team?: TeamDocument;
  diagramRoot?: SubDiagram;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
  /** Other people currently on this same view, in a collaborative
   * session - already filtered by the caller to just those actually on
   * "timeline" (never includes peers on a different view). Empty
   * outside of a session. */
  peers?: PresenceInfo[];
  /** Reports which item this person currently has open, for presence
   * broadcasting - null when nothing's selected. */
  onFocusedItemChange?: (itemId: string | null) => void;
}

export function TimelineView({
  programIncrementsStore,
  requirementsStore,
  milestonesStore,
  team,
  diagramRoot,
  onNavigateToNode,
  onCreateLinkedNode,
  onNavigateToRequirement,
  peers = [],
  onFocusedItemChange,
}: TimelineViewProps) {
  const fallbackMilestonesStore = useMemo(() => createLocalMilestonesStore([]), []);
  const activeMilestonesStore = milestonesStore ?? fallbackMilestonesStore;

  const programIncrements = useSyncExternalStore(
    programIncrementsStore.subscribe,
    programIncrementsStore.getSnapshot,
    programIncrementsStore.getSnapshot,
  );
  const requirements = useSyncExternalStore(
    requirementsStore.subscribe,
    requirementsStore.getSnapshot,
    requirementsStore.getSnapshot,
  );
  const milestones = useSyncExternalStore(
    activeMilestonesStore.subscribe,
    activeMilestonesStore.getSnapshot,
    activeMilestonesStore.getSnapshot,
  );

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [isAddingMilestone, setIsAddingMilestone] = useState(false);
  const [addMilestoneDate, setAddMilestoneDate] = useState<string | undefined>(undefined);
  const [chartMode, setChartMode] = useState<'board' | 'gantt'>('board');
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [filterEpicId, setFilterEpicId] = useState<string>('all');

  useEffect(() => {
    if (!draggedItemId) return;
    const handleDragEnd = () => {
      setDraggedItemId(null);
    };
    window.addEventListener('dragend', handleDragEnd);
    window.addEventListener('drop', handleDragEnd);
    return () => {
      window.removeEventListener('dragend', handleDragEnd);
      window.removeEventListener('drop', handleDragEnd);
    };
  }, [draggedItemId]);

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

  // Rebroadcasts this peer's own selection so others' "someone else has
  // this item open" indicator (see ItemCard's peersHere prop) stays
  // current - selectedItemId is exactly "which item this person has
  // open" already, nothing extra to track for that purpose.
  useEffect(() => {
    onFocusedItemChange?.(selectedItemId);
  }, [selectedItemId, onFocusedItemChange]);

  const onAddPI = () => {
    programIncrementsStore.addPI();
  };

  const onUpdatePIName = (piId: string, name: string) => {
    programIncrementsStore.updatePIName(piId, name);
  };

  const onUpdatePIStart = (piId: string, startDate: string) => {
    programIncrementsStore.updatePIStart(piId, startDate);
  };

  // Deletes the whole PI and unassigns any requirement items that were in
  // any of its sprints - two separate store calls (program increments,
  // then requirements), but both happen synchronously within this one
  // handler, well under the undo history's debounce window, so they still
  // land as a single undo step rather than two.
  const onDeletePI = (piId: string) => {
    const pi = programIncrements.find((p) => p.id === piId);
    if (!pi) return;
    const sprintIds = pi.sprints.map((s) => s.id);
    programIncrementsStore.deletePI(piId);
    requirementsStore.unassignItemsFromSprints(sprintIds);
  };

  const onAddSprint = (piId: string) => {
    programIncrementsStore.addSprint(piId);
  };

  const onUpdateSprintName = (piId: string, sprintId: string, name: string) => {
    programIncrementsStore.updateSprintName(piId, sprintId, name);
  };

  const onUpdateSprintEnd = (piId: string, sprintId: string, newEndDate: string) => {
    programIncrementsStore.updateSprintEnd(piId, sprintId, newEndDate);
  };

  const onDeleteSprint = (piId: string, sprintId: string) => {
    programIncrementsStore.deleteSprint(piId, sprintId);
    requirementsStore.unassignItemsFromSprints([sprintId]);
  };

  const onMoveSprint = (piId: string, sprintId: string, direction: 'up' | 'down') => {
    programIncrementsStore.moveSprint(piId, sprintId, direction);
  };

  const onUpdateItem = (id: string, patch: Partial<RequirementItem>) => {
    requirementsStore.updateItem(id, patch);
  };

  const onConvertItemType = (id: string, newTypeId: string) => {
    const newId = requirementsStore.convertItemType(id, newTypeId);
    if (selectedItemId === id && newId) {
      setSelectedItemId(newId);
    }
  };

  const onDeleteItem = (id: string) => {
    requirementsStore.deleteItem(id);
  };

  const onAddMilestone = (candidate: Omit<Milestone, 'id' | 'createdAt' | 'updatedAt'>) => {
    return activeMilestonesStore.addMilestone(candidate);
  };

  const onUpdateMilestone = (id: string, patch: Partial<Omit<Milestone, 'id'>>) => {
    activeMilestonesStore.updateMilestone(id, patch);
  };

  const onDeleteMilestone = (id: string) => {
    activeMilestonesStore.deleteMilestone(id);
  };

  const onCreateAndAssignCategory = (itemId: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    requirementsStore.createAndAssignCategory(itemId, trimmed);
  };

  const onDeleteCategory = (categoryId: string) => {
    requirementsStore.deleteCategory(categoryId);
  };

  const onMoveItemToSprint = (itemId: string, targetSprintId: string): string | null => {
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
    requirementsStore.updateItem(itemId, { sprintId: targetSprintId });
    return null;
  };

  const onAddRelationship = (
    typeId: string,
    fromItemId: string,
    toItemId: string,
  ): string | null => {
    return requirementsStore.addRelationship(typeId, fromItemId, toItemId);
  };

  const onDeleteRelationship = (relationshipId: string) => {
    requirementsStore.deleteRelationship(relationshipId);
  };

  // Grouped once per render for both count badges and the visual board
  // columns - a single pass over requirements.items builds a lookup all
  // sprint rows and board columns share.
  const itemsBySprintId = new Map<string, RequirementItem[]>();
  for (const item of requirements.items) {
    if (!item.sprintId) continue;
    if (!isItemWorkable(requirements, item)) continue;
    const list = itemsBySprintId.get(item.sprintId);
    if (list) {
      list.push(item);
    } else {
      itemsBySprintId.set(item.sprintId, [item]);
    }
  }

  const selectedItem = selectedItemId
    ? requirements.items.find((it) => it.id === selectedItemId)
    : null;

  // Items with no sprintId at all were previously invisible anywhere on
  // this board - there was no way to see them or drag them into a sprint
  // without leaving for the Requirements view first. Surfacing them here
  // as a dedicated, always-a-valid-drop-target section closes that gap.
  const backlogItems = requirements.items.filter(
    (item) => !item.sprintId && isItemWorkable(requirements, item),
  );

  // Every sprint's date range, across ALL program increments - needed
  // here (unlike within a single PICard, which only knows its own PI's
  // sprints) because a blocker and the item it blocks can sit in sprints
  // that belong to entirely different PIs.
  const { allSprintRangesById, sprintRangesByItemId, conflictSeverityByItemId } = useMemo(() => {
    const allRanges = new Map<string, { startDate: string; endDate: string }>();
    for (const pi of programIncrements) {
      for (const range of computeSprintDateRanges(pi)) {
        allRanges.set(range.sprintId, { startDate: range.startDate, endDate: range.endDate });
      }
    }
    // Each currently-scheduled workable item's own sprint range - the
    // same shape the Gantt view's conflict detector expects, built once
    // here so both the passive "is this card currently in conflict"
    // check and the "would assigning it here create one" pre-check share
    // one source.
    const byItemId = new Map<string, { startDate: string; endDate: string }>();
    for (const item of requirements.items) {
      if (!item.sprintId || !isItemWorkable(requirements, item)) continue;
      const range = allRanges.get(item.sprintId);
      if (range) byItemId.set(item.id, range);
    }
    // Items already on the board whose blocker won't finish in time -
    // same detector the Gantt view uses, applied here so the board can
    // flag these directly on their cards rather than only being visible
    // in a separate view.
    const conflicts = findScheduleConflicts(
      requirements.items,
      requirements.relationships,
      requirements.relationshipTypes,
      requirements.itemTypes,
      byItemId,
    );
    // An item can have more than one conflict at once (e.g. one blocker
    // in the same sprint - a risk - and another entirely unscheduled - a
    // hard block). The card should reflect the MOST severe one, so a
    // "blocked" is never masked by a milder "risk" that happens to
    // appear later in the conflicts list. Keeps the specific blocker too
    // (not just the severity), so the card can name it directly rather
    // than just flagging "something's wrong".
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
  const onUnassignItem = (itemId: string) => onUpdateItem(itemId, { sprintId: undefined });

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

  const selectedMilestone = selectedMilestoneId
    ? milestones.find((m) => m.id === selectedMilestoneId)
    : null;

  return (
    <div className="timeline-view">
      <div className="timeline-view__toolbar">
        <button type="button" className="timeline-view__add-pi" onClick={onAddPI}>
          <Plus size={13} />
          Program Increment
        </button>
        <button
          type="button"
          className="timeline-view__add-milestone"
          onClick={() => {
            setAddMilestoneDate(undefined);
            setIsAddingMilestone(true);
          }}
          title="Create a new Marker"
        >
          <Diamond size={13} />
          Marker
        </button>
        <div className="timeline-view__mode-toggle">
          <button
            type="button"
            className={chartMode === 'board' ? 'active' : undefined}
            onClick={() => setChartMode('board')}
          >
            Board
          </button>
          <button
            type="button"
            className={chartMode === 'gantt' ? 'active' : undefined}
            onClick={() => setChartMode('gantt')}
          >
            <GanttChartSquare size={12} />
            Gantt
          </button>
        </div>

        {epicsWithSchedule.length > 0 && (
          <div className="timeline-view__epic-filter">
            <span style={{ fontSize: '12px', color: 'var(--chrome-text-dim)' }}>Epic:</span>
            <select
              className="timeline-view__epic-select"
              value={filterEpicId}
              onChange={(e) => setFilterEpicId(e.target.value)}
              title="Filter timeline cards by Epic"
            >
              <option value="all">All Epics</option>
              {epicsWithSchedule.map(({ epic, schedule }) => (
                <option key={epic.id} value={epic.id}>
                  {epic.id}: {epic.title || 'Untitled'} ({schedule.scheduledChildrenCount}/
                  {schedule.totalChildrenCount} scheduled)
                </option>
              ))}
            </select>
          </div>
        )}

        <PresenceAvatarStack peers={peers} requirements={requirements} />
      </div>

      {chartMode === 'gantt' ? (
        <GanttChart
          programIncrements={programIncrements}
          requirements={requirements}
          milestones={milestones}
          filterEpicId={filterEpicId}
          filteredChildItemIds={filteredChildItemIds}
          onSelectItem={(id) => setSelectedItemId(id)}
          onSelectMilestone={(id) => setSelectedMilestoneId(id)}
          onNavigateToRequirement={onNavigateToRequirement}
        />
      ) : (
        <div className="timeline-view__content">
          {/* Scheduled Releases & Milestones Overview Section (FR-003, AC-002, AC-009) */}
          <MilestonesSection
            milestones={milestones}
            onSelectMilestone={(id) => setSelectedMilestoneId(id)}
            onAddMilestone={() => {
              setAddMilestoneDate(undefined);
              setIsAddingMilestone(true);
            }}
          />

          {backlogItems.length > 0 && (
            <BacklogSection
              items={backlogItems}
              requirements={requirements}
              team={team}
              draggedItemId={draggedItemId}
              blockingItemIds={blockingItemIds}
              parentEpicByItemId={parentEpicByItemId}
              filteredChildItemIds={filteredChildItemIds}
              onSelectItem={(id) => setSelectedItemId(id)}
              onDragStartItem={(id) => setDraggedItemId(id)}
              onDragEndItem={() => setDraggedItemId(null)}
              onDropItem={onUnassignItem}
              onUpdateItem={onUpdateItem}
            />
          )}
          {programIncrements.length === 0 ? (
            <p className="timeline-view__empty">
              No program increments yet - add one above to start defining sprints.
            </p>
          ) : (
            programIncrements.map((pi) => (
              <ProgramIncrementCard
                key={pi.id}
                pi={pi}
                requirements={requirements}
                milestones={milestones}
                team={team}
                itemsBySprintId={itemsBySprintId}
                backlogItems={backlogItems}
                conflictSeverityByItemId={conflictSeverityByItemId}
                draggedItemId={draggedItemId}
                blockingItemIds={blockingItemIds}
                sprintRangesByItemId={sprintRangesByItemId}
                parentEpicByItemId={parentEpicByItemId}
                filteredChildItemIds={filteredChildItemIds}
                onSelectItem={(id) => setSelectedItemId(id)}
                onSelectMilestone={(id) => setSelectedMilestoneId(id)}
                onDragStartItem={(id) => setDraggedItemId(id)}
                onDragEndItem={() => setDraggedItemId(null)}
                onDropItem={onMoveItemToSprint}
                onUpdateItem={onUpdateItem}
                onUpdateName={(name) => onUpdatePIName(pi.id, name)}
                onUpdateStart={(startDate) => onUpdatePIStart(pi.id, startDate)}
                onDelete={() => onDeletePI(pi.id)}
                onAddSprint={() => onAddSprint(pi.id)}
                onUpdateSprintName={(sprintId, name) => onUpdateSprintName(pi.id, sprintId, name)}
                onUpdateSprintEnd={(sprintId, endDate) =>
                  onUpdateSprintEnd(pi.id, sprintId, endDate)
                }
                onDeleteSprint={(sprintId) => onDeleteSprint(pi.id, sprintId)}
                onMoveSprint={(sprintId, direction) => onMoveSprint(pi.id, sprintId, direction)}
                programIncrementsStore={programIncrementsStore}
              />
            ))
          )}
        </div>
      )}

      {selectedItem && (
        <RequirementDetailModal
          item={selectedItem}
          doc={requirements}
          programIncrements={programIncrements}
          milestones={milestones}
          team={team}
          diagramRoot={diagramRoot}
          onNavigateToNode={onNavigateToNode}
          onCreateLinkedNode={onCreateLinkedNode}
          onClose={() => setSelectedItemId(null)}
          onUpdateItem={onUpdateItem}
          onConvertItemType={onConvertItemType}
          onDeleteItem={onDeleteItem}
          onNavigateToRequirement={onNavigateToRequirement}
          onSelectItem={(id) => setSelectedItemId(id)}
          onSelectMilestone={(id) => setSelectedMilestoneId(id)}
          onCreateAndAssignCategory={onCreateAndAssignCategory}
          onDeleteCategory={onDeleteCategory}
          onAddRelationship={onAddRelationship}
          onDeleteRelationship={onDeleteRelationship}
        />
      )}

      {selectedMilestone && (
        <MilestoneDetailModal
          milestone={selectedMilestone}
          doc={requirements}
          programIncrements={programIncrements}
          onClose={() => setSelectedMilestoneId(null)}
          onUpdateMilestone={onUpdateMilestone}
          onDeleteMilestone={onDeleteMilestone}
          onNavigateToRequirement={onNavigateToRequirement}
          onSelectItem={(id) => setSelectedItemId(id)}
        />
      )}

      {isAddingMilestone && (
        <AddMilestoneModal
          initialDate={addMilestoneDate}
          doc={requirements}
          onClose={() => {
            setIsAddingMilestone(false);
            setAddMilestoneDate(undefined);
          }}
          onCreateMilestone={onAddMilestone}
          onMilestoneCreated={(id) => setSelectedMilestoneId(id)}
        />
      )}
    </div>
  );
}
