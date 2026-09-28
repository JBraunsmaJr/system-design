import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Diamond,
  GanttChartSquare,
  Plus,
} from 'lucide-react';
import type { ProgramIncrementsStore } from '../../collab/stores/programIncrementsStore';
import type { RequirementsStore } from '../../collab/stores/requirementsStore';
import type { MilestonesStore } from '../../collab/stores/milestonesStore';
import type { Milestone } from '../../domain/timeline/milestones';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import type { SubDiagram } from '../../domain/canvas/types';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { PresenceInfo } from '../../collab/sync/session';
import type { RequirementItem } from '../../domain/requirements/requirementsTypes';
import { createLocalMilestonesStore } from '../../collab/stores/milestonesStore';
import { RequirementDetailModal } from './RequirementDetailModal';
import { MilestoneDetailModal } from './MilestoneDetailModal';
import { AddMilestoneModal } from './AddMilestoneModal';
import { GanttChart } from './GanttChart';
import { useTimelineSchedule } from './hooks/useTimelineSchedule';
import { MilestoneSummaryBar } from './components/MilestoneSummaryBar';
import { TimelineBacklog } from './components/TimelineBacklog';
import { ProgramIncrementCard } from './components/SprintTimelineGrid';

export interface TimelineViewProps {
  programIncrementsStore: ProgramIncrementsStore;
  requirementsStore: RequirementsStore;
  milestonesStore?: MilestonesStore;
  team?: TeamDocument;
  diagramRoot?: SubDiagram;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
  peers?: PresenceInfo[];
  onFocusedItemChange?: (itemId: string | null) => void;
}

function getPresenceInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function PresenceAvatarStack({
  peers,
  requirements,
}: {
  peers: PresenceInfo[];
  requirements: { items: RequirementItem[] };
}) {
  if (peers.length === 0) return null;

  const MAX_DISPLAY = 4;
  const displayPeers = peers.slice(0, MAX_DISPLAY);
  const overflowCount = peers.length - MAX_DISPLAY;

  const summaryLines = peers.map((p) => {
    const focusedItem = p.focusedItemId
      ? requirements.items.find((it) => it.id === p.focusedItemId)
      : null;
    const action = focusedItem ? `viewing ${focusedItem.id}: ${focusedItem.title}` : 'browsing';
    return `• ${p.name} (${action})`;
  });

  const titleText = `Users on Timeline (${peers.length}):\n${summaryLines.join('\n')}`;

  return (
    <div
      className="timeline-view__presence-stack"
      title={titleText}
      aria-label={`Users on Timeline: ${peers.length}`}
    >
      <div className="timeline-view__presence-avatars">
        {displayPeers.map((p, idx) => {
          const focusedItem = p.focusedItemId
            ? requirements.items.find((it) => it.id === p.focusedItemId)
            : null;
          const statusText = focusedItem
            ? `viewing ${focusedItem.id}: ${focusedItem.title}`
            : 'browsing';
          return (
            <span
              key={p.clientId}
              className="timeline-view__presence-avatar"
              style={{
                backgroundColor: p.color,
                zIndex: displayPeers.length - idx,
              }}
              title={`${p.name} — ${statusText}`}
            >
              {getPresenceInitials(p.name)}
            </span>
          );
        })}
        {overflowCount > 0 && (
          <span
            className="timeline-view__presence-avatar timeline-view__presence-avatar--more"
            style={{ zIndex: 0 }}
            title={`${overflowCount} more user${overflowCount === 1 ? '' : 's'}`}
          >
            +{overflowCount}
          </span>
        )}
      </div>

      <div className="timeline-view__presence-popover" role="tooltip">
        <div className="timeline-view__presence-popover-header">
          Users on Timeline ({peers.length})
        </div>
        <div className="timeline-view__presence-popover-list">
          {peers.map((p) => {
            const focusedItem = p.focusedItemId
              ? requirements.items.find((it) => it.id === p.focusedItemId)
              : null;
            const statusText = focusedItem
              ? `viewing ${focusedItem.id}: ${focusedItem.title}`
              : 'browsing';
            return (
              <div key={p.clientId} className="timeline-view__presence-popover-item">
                <span
                  className="timeline-view__presence-popover-avatar"
                  style={{ backgroundColor: p.color }}
                >
                  {getPresenceInitials(p.name)}
                </span>
                <div className="timeline-view__presence-popover-info">
                  <span className="timeline-view__presence-popover-name">{p.name}</span>
                  <span className="timeline-view__presence-popover-status">{statusText}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
    const handleDragEnd = () => setDraggedItemId(null);
    window.addEventListener('dragend', handleDragEnd);
    window.addEventListener('drop', handleDragEnd);
    return () => {
      window.removeEventListener('dragend', handleDragEnd);
      window.removeEventListener('drop', handleDragEnd);
    };
  }, [draggedItemId]);

  const {
    epicsWithSchedule,
    parentEpicByItemId,
    filteredChildItemIds,
    itemsBySprintId,
    backlogItems,
    conflictSeverityByItemId,
    blockingItemIds,
    sprintRangesByItemId,
    checkMoveConflict,
  } = useTimelineSchedule({
    requirements,
    programIncrements,
    milestones,
    filterEpicId,
    draggedItemId,
  });

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
    const conflictMsg = checkMoveConflict(itemId, targetSprintId);
    if (conflictMsg) return conflictMsg;
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

  const onUnassignItem = (itemId: string) => onUpdateItem(itemId, { sprintId: undefined });

  const selectedItem = selectedItemId
    ? requirements.items.find((it) => it.id === selectedItemId)
    : null;

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
              {epicsWithSchedule.map((e) => (
                <option key={e.epic.id} value={e.epic.id}>
                  {e.epic.id} {e.epic.title ? `— ${e.epic.title}` : ''}
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
          <MilestoneSummaryBar
            milestones={milestones}
            onSelectMilestone={(id) => setSelectedMilestoneId(id)}
            onAddMilestone={() => {
              setAddMilestoneDate(undefined);
              setIsAddingMilestone(true);
            }}
          />

          {backlogItems.length > 0 && (
            <TimelineBacklog
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
        />
      )}

      {isAddingMilestone && (
        <AddMilestoneModal
          doc={requirements}
          initialDate={addMilestoneDate}
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
