import { useEffect, useMemo, useState, useRef, useSyncExternalStore } from "react";
import { AlertTriangle, CalendarRange, ChevronDown, ChevronRight, ChevronUp, GanttChartSquare, Inbox, Plus, Trash2, ShieldAlert, Diamond } from "lucide-react";
import {
  computeSprintDateRanges,
  getSprintActiveReservations,
  type ProgramIncrement,
  type Sprint,
  type CapacityReservation,
} from "../../domain/programIncrements";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import { findScheduleConflicts, checkScheduleConflict, findBlockingItemIds, type ScheduleConflictSeverity } from "../../domain/scheduleConflicts";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import type { RequirementsStore } from "../../collab/requirementsStore";
import type { ProgramIncrementsStore } from "../../collab/programIncrementsStore";
import type { MilestonesStore } from "../../collab/milestonesStore";
import { createLocalMilestonesStore } from "../../collab/milestonesStore";
import type { Milestone } from "../../domain/milestones";
import { getMilestoneColor, getMilestoneTypeLabel } from "../../domain/milestones";
import { computeSprintMilestoneSummary } from "../../domain/sprintSummaries";
import { getAllEpicsWithInferredSchedule, getChildItemsForParent } from "../../domain/epicScheduling";
import type { TeamDocument } from "../../domain/teamTypes";
import type { SubDiagram } from "../../domain/types";
import type { DiagramPath } from "../../domain/subDiagramTree";
import type { PresenceInfo } from "../../collab/session";
import { computeSprintCapacity, computePICapacities } from "../../domain/teamCapacity";
import { SprintCapacityBar } from "../team/SprintCapacityBar";
import { MemberPicker } from "../team/MemberPicker";
import { PointsPicker } from "../team/PointsPicker";
import { RequirementDetailModal } from "./RequirementDetailModal";
import { MilestoneDetailModal } from "./MilestoneDetailModal";
import { AddMilestoneModal } from "./AddMilestoneModal";
import { GanttChart } from "./GanttChart";
import { SprintQuickAdd } from "./SprintQuickAdd";
import { ManageReservationsModal } from "./ManageReservationsModal";

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

  const programIncrements = useSyncExternalStore(programIncrementsStore.subscribe, programIncrementsStore.getSnapshot);
  const requirements = useSyncExternalStore(requirementsStore.subscribe, requirementsStore.getSnapshot);
  const milestones = useSyncExternalStore(activeMilestonesStore.subscribe, activeMilestonesStore.getSnapshot);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [isAddingMilestone, setIsAddingMilestone] = useState(false);
  const [addMilestoneDate, setAddMilestoneDate] = useState<string | undefined>(undefined);
  const [chartMode, setChartMode] = useState<"board" | "gantt">("board");
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [filterEpicId, setFilterEpicId] = useState<string>("all");

  const epicsWithSchedule = useMemo(() => {
    return getAllEpicsWithInferredSchedule(requirements, programIncrements, milestones);
  }, [requirements, programIncrements, milestones]);

  const parentEpicByItemId = useMemo(() => {
    const map = new Map<string, RequirementItem>();
    const epics = requirements.items.filter((i) => i.typeId === "epic" || i.typeId.toLowerCase().includes("epic"));
    const epicIds = new Set(epics.map((e) => e.id));
    for (const rel of requirements.relationships) {
      if (epicIds.has(rel.fromItemId) && (rel.typeId === "parent-of" || rel.typeId === "relates-to")) {
        const epic = epics.find((e) => e.id === rel.fromItemId);
        if (epic) map.set(rel.toItemId, epic);
      } else if (epicIds.has(rel.toItemId) && rel.typeId === "child-of") {
        const epic = epics.find((e) => e.id === rel.toItemId);
        if (epic) map.set(rel.fromItemId, epic);
      }
    }
    return map;
  }, [requirements]);

  const filteredChildItemIds = useMemo(() => {
    if (filterEpicId === "all") return null;
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

  const onMoveSprint = (piId: string, sprintId: string, direction: "up" | "down") => {
    programIncrementsStore.moveSprint(piId, sprintId, direction);
  };

  const onUpdateItem = (id: string, patch: Partial<RequirementItem>) => {
    requirementsStore.updateItem(id, patch);
  };

  const onConvertItemType = (id: string, newTypeId: string) => {
    requirementsStore.convertItemType(id, newTypeId);
  };

  const onDeleteItem = (id: string) => {
    requirementsStore.deleteItem(id);
  };

  const onAddMilestone = (candidate: Omit<Milestone, "id" | "createdAt" | "updatedAt">) => {
    return activeMilestonesStore.addMilestone(candidate);
  };

  const onUpdateMilestone = (id: string, patch: Partial<Omit<Milestone, "id">>) => {
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
        sprintRangesByItemId
      );
      if (conflict && conflict.severity === "blocked") {
        return conflict.blockerRange
          ? `Can't schedule here - blocked by ${conflict.blocker.id}, which isn't finished until ${conflict.blockerRange.endDate}.`
          : `Can't schedule here - blocked by ${conflict.blocker.id}, which isn't scheduled yet.`;
      }
    }
    requirementsStore.updateItem(itemId, { sprintId: targetSprintId });
    return null;
  };

  const onAddRelationship = (typeId: string, fromItemId: string, toItemId: string): string | null => {
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

  const selectedItem = selectedItemId ? requirements.items.find((it) => it.id === selectedItemId) : null;

  // Items with no sprintId at all were previously invisible anywhere on
  // this board - there was no way to see them or drag them into a sprint
  // without leaving for the Requirements view first. Surfacing them here
  // as a dedicated, always-a-valid-drop-target section closes that gap.
  const backlogItems = requirements.items.filter((item) => !item.sprintId && isItemWorkable(requirements, item));

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
      byItemId
    );
    // An item can have more than one conflict at once (e.g. one blocker
    // in the same sprint - a risk - and another entirely unscheduled - a
    // hard block). The card should reflect the MOST severe one, so a
    // "blocked" is never masked by a milder "risk" that happens to
    // appear later in the conflicts list. Keeps the specific blocker too
    // (not just the severity), so the card can name it directly rather
    // than just flagging "something's wrong".
    const severityById = new Map<string, { severity: ScheduleConflictSeverity; blocker: RequirementItem }>();
    for (const c of conflicts) {
      const existing = severityById.get(c.item.id);
      if (!existing || existing.severity !== "blocked") {
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
      requirements.items
    );
  }, [draggedItemId, requirements.relationships, requirements.relationshipTypes, requirements.itemTypes, requirements.items]);

  const selectedMilestone = selectedMilestoneId ? milestones.find((m) => m.id === selectedMilestoneId) : null;

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
          title="Create a new Release or Timeline Milestone (FR-001)"
        >
          <Diamond size={13} />
          Release / Milestone
        </button>
        <div className="timeline-view__mode-toggle">
          <button
            type="button"
            className={chartMode === "board" ? "active" : undefined}
            onClick={() => setChartMode("board")}
          >
            Board
          </button>
          <button
            type="button"
            className={chartMode === "gantt" ? "active" : undefined}
            onClick={() => setChartMode("gantt")}
          >
            <GanttChartSquare size={12} />
            Gantt
          </button>
        </div>

        {epicsWithSchedule.length > 0 && (
          <div className="timeline-view__epic-filter">
            <span style={{ fontSize: "12px", color: "var(--chrome-text-dim)" }}>Epic:</span>
            <select
              className="timeline-view__epic-select"
              value={filterEpicId}
              onChange={(e) => setFilterEpicId(e.target.value)}
              title="Filter timeline cards by Epic"
            >
              <option value="all">All Epics</option>
              {epicsWithSchedule.map(({ epic, schedule }) => (
                <option key={epic.id} value={epic.id}>
                  {epic.id}: {epic.title || "Untitled"} ({schedule.scheduledChildrenCount}/{schedule.totalChildrenCount} scheduled)
                </option>
              ))}
            </select>
          </div>
        )}

        <PresenceAvatarStack peers={peers} requirements={requirements} />
      </div>

      {chartMode === "gantt" ? (
        <GanttChart
          programIncrements={programIncrements}
          requirements={requirements}
          milestones={milestones}
          onSelectItem={(id) => setSelectedItemId(id)}
          onSelectMilestone={(id) => setSelectedMilestoneId(id)}
          onAddMilestoneOnDate={(date) => {
            setAddMilestoneDate(date);
            setIsAddingMilestone(true);
          }}
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
              onUpdateSprintEnd={(sprintId, endDate) => onUpdateSprintEnd(pi.id, sprintId, endDate)}
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

interface PresenceAvatarStackProps {
  peers: PresenceInfo[];
  requirements: RequirementsDocument;
}

function getPresenceInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function PresenceAvatarStack({ peers, requirements }: PresenceAvatarStackProps) {
  if (peers.length === 0) return null;

  const MAX_DISPLAY = 4;
  const displayPeers = peers.slice(0, MAX_DISPLAY);
  const overflowCount = peers.length - MAX_DISPLAY;

  const summaryLines = peers.map((p) => {
    const focusedItem = p.focusedItemId ? requirements.items.find((it) => it.id === p.focusedItemId) : null;
    const action = focusedItem ? `viewing ${focusedItem.id}: ${focusedItem.title}` : "browsing";
    return `• ${p.name} (${action})`;
  });

  const titleText = `Users on Timeline (${peers.length}):\n${summaryLines.join("\n")}`;

  return (
    <div
      className="timeline-view__presence-stack"
      title={titleText}
      aria-label={`Users on Timeline: ${peers.length}`}
    >
      <div className="timeline-view__presence-avatars">
        {displayPeers.map((p, idx) => {
          const focusedItem = p.focusedItemId ? requirements.items.find((it) => it.id === p.focusedItemId) : null;
          const statusText = focusedItem ? `viewing ${focusedItem.id}: ${focusedItem.title}` : "browsing";
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
            title={`${overflowCount} more user${overflowCount === 1 ? "" : "s"}`}
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
            const focusedItem = p.focusedItemId ? requirements.items.find((it) => it.id === p.focusedItemId) : null;
            const statusText = focusedItem ? `viewing ${focusedItem.id}: ${focusedItem.title}` : "browsing";
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

interface MilestonesSectionProps {
  milestones: Milestone[];
  onSelectMilestone: (id: string) => void;
  onAddMilestone: () => void;
}

function MilestonesSection({ milestones, onSelectMilestone, onAddMilestone }: MilestonesSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <section className="milestones-section">
      <div className="milestones-section__header">
        <button
          type="button"
          className="milestones-section__collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? "Expand milestones" : "Collapse milestones"}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <Diamond size={14} className="milestones-section__icon" />
        <span className="milestones-section__title">Milestones & Releases</span>
        <span className="milestones-section__count" title={`${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`}>
          {milestones.length}
        </span>
        <button
          type="button"
          className="milestones-section__add-btn"
          onClick={onAddMilestone}
          title="Create a new Release or Milestone"
        >
          <Plus size={12} />
          <span>Add Release</span>
        </button>
      </div>

      {!isCollapsed && (
        <div className="milestones-section__items">
          {milestones.length === 0 ? (
            <p className="milestones-section__empty">
              No releases or milestones scheduled yet. Click <strong>Add Release</strong> to place point-in-time outcomes on the timeline.
            </p>
          ) : (
            milestones.map((m) => {
              const color = getMilestoneColor(m);
              const typeLabel = getMilestoneTypeLabel(m.type);
              const relatedCount = m.relatedWorkableItemIds?.length ?? 0;
              return (
                <button
                  key={m.id}
                  type="button"
                  className="milestones-section__card"
                  style={{ borderLeftColor: color }}
                  onClick={() => onSelectMilestone(m.id)}
                  title={`${typeLabel}: ${m.name} \u2022 Scheduled: ${m.scheduledAt}${relatedCount > 0 ? ` \u2022 ${relatedCount} related work item${relatedCount === 1 ? "" : "s"}` : ""}`}
                >
                  <div className="milestones-section__card-header">
                    <span className="milestones-section__card-shape" style={{ color }}>
                      ◆
                    </span>
                    <span className="milestones-section__card-type" style={{ color }}>
                      {typeLabel}
                    </span>
                    {m.version && (
                      <span className="milestones-section__card-version">v{m.version}</span>
                    )}
                  </div>
                  <div className="milestones-section__card-name">{m.name}</div>
                  <div className="milestones-section__card-footer">
                    <span className="milestones-section__card-date">{m.scheduledAt}</span>
                    {relatedCount > 0 && (
                      <span className="milestones-section__card-work-badge">
                        {relatedCount} {relatedCount === 1 ? "item" : "items"}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

interface BacklogSectionProps {
  items: RequirementItem[];
  requirements: RequirementsDocument;
  team?: TeamDocument;
  draggedItemId: string | null;
  blockingItemIds?: Set<string>;
  parentEpicByItemId?: Map<string, RequirementItem>;
  filteredChildItemIds?: Set<string> | null;
  onSelectItem: (itemId: string) => void;
  onDragStartItem: (itemId: string) => void;
  onDragEndItem: () => void;
  onDropItem: (itemId: string) => void;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
}

/**
 * Shows every requirement item with no sprintId - previously there was no
 * way to see or drag these into a sprint from the board itself, only from
 * the Requirements view's SprintPicker. This is a horizontal, wrapping
 * strip rather than a narrow column (unlike SprintBoardColumn) since it's
 * a single top-level section rather than one of several side-by-side
 * columns, and reuses the same pi-board-item card styling so a dragged
 * item looks identical whether it's coming from here or from a sprint.
 * Dropping onto this section unassigns the item (clears sprintId) rather
 * than assigning it to anything - the drag logic (counter-based
 * enter/leave tracking, dataTransfer + state fallback) mirrors
 * SprintBoardColumn's, kept separate rather than extracted into a shared
 * component to avoid touching that already-working code while adding
 * this.
 *
 * With a large backlog (100+ items isn't unusual) this needed both a
 * search filter and a height cap with internal scrolling, plus a full
 * collapse - a search box alone still leaves a very tall list to scroll
 * past to reach the PI cards below, and collapsing alone loses the
 * at-a-glance count/reference value entirely.
 */
function BacklogSection({
  items,
  requirements,
  team,
  draggedItemId,
  blockingItemIds,
  parentEpicByItemId,
  filteredChildItemIds,
  onSelectItem,
  onDragStartItem,
  onDragEndItem,
  onDropItem,
  onUpdateItem,
}: BacklogSectionProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const dragCounter = useRef(0);

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
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    const itemId = e.dataTransfer.getData("text/plain") || draggedItemId;
    if (itemId) {
      onDropItem(itemId);
    }
  };

  const q = query.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (filteredChildItemIds && !filteredChildItemIds.has(item.id)) return false;
    if (q === "") return true;
    return item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
  });

  return (
    <section className="backlog-section">
      <div className="backlog-section__header">
        <button
          type="button"
          className="backlog-section__collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? "Expand backlog" : "Collapse backlog"}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <Inbox size={14} className="backlog-section__icon" />
        <span className="backlog-section__title">Backlog</span>
        <span className="backlog-section__count" title={`${items.length} unassigned item${items.length === 1 ? "" : "s"}`}>
          {items.length}
        </span>
        {!isCollapsed && (
          <>
            <input
              className="backlog-section__search"
              placeholder="Search backlog..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="backlog-section__hint">Drag into a sprint below to schedule it</span>
          </>
        )}
      </div>
      {!isCollapsed && (
        <div
          className={`backlog-section__items${isDragOver ? " is-drag-over" : ""}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {filteredItems.length === 0 ? (
            <p className="backlog-section__empty">No backlog items match criteria.</p>
          ) : (
            filteredItems.map((item) => {
              const type = getItemType(requirements, item.typeId);
              const category = item.categoryId ? requirements.categories.find((c) => c.id === item.categoryId) : undefined;
              const isDragging = draggedItemId === item.id;
              const isBlocker = blockingItemIds?.has(item.id);
              const parentEpic = parentEpicByItemId?.get(item.id);
              return (
                <div
                  key={item.id}
                  className={`pi-board-item backlog-section__item${isDragging ? " is-dragging" : ""}${isBlocker ? " is-blocker-highlight" : ""}`}
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", item.id);
                    e.dataTransfer.effectAllowed = "move";
                    requestAnimationFrame(() => onDragStartItem(item.id));
                  }}
                  onDragEnd={() => onDragEndItem()}
                  onClick={() => onSelectItem(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectItem(item.id);
                    }
                  }}
                  title="Click to view description • Drag into a sprint to schedule it"
                >
                  <div className="pi-board-item__header">
                    <span
                      className="pi-board-item__id"
                      style={{
                        color: type?.color ?? "var(--chrome-text-dim)",
                        borderColor: `${type?.color ?? "var(--chrome-border)"}66`,
                      }}
                    >
                      {item.id}
                    </span>
                    {parentEpic && (
                      <span
                        className="pi-board-item__epic-badge"
                        title={`Epic: ${parentEpic.id} ${parentEpic.title || ""}`}
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
                    {category && (
                      <span
                        className="pi-board-item__category"
                        style={{ color: category.color, borderColor: `${category.color}44`, background: `${category.color}18` }}
                      >
                        {category.label}
                      </span>
                    )}
                  </div>
                  <div className="pi-board-item__title">{item.title || "Untitled"}</div>
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
      )}
    </section>
  );
}

interface ProgramIncrementCardProps {
  pi: ProgramIncrement;
  requirements: RequirementsDocument;
  milestones?: Milestone[];
  team?: TeamDocument;
  itemsBySprintId: Map<string, RequirementItem[]>;
  backlogItems: RequirementItem[];
  conflictSeverityByItemId: Map<string, { severity: ScheduleConflictSeverity; blocker: RequirementItem }>;
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
  onMoveSprint: (sprintId: string, direction: "up" | "down") => void;
  programIncrementsStore: ProgramIncrementsStore;
}

function ProgramIncrementCard({
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
        <input className="pi-card__name" value={pi.name} onChange={(e) => onUpdateName(e.target.value)} />
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
          <div
            className="pi-card__capacity-totals"
            title={`PI Capacity: ${piCapacityTotals.totalAssignedPoints} used / ${piCapacityTotals.totalCapacityPoints} total available (${piCapacityTotals.totalReservedPoints} reserved, ${piCapacityTotals.grossCapacityPoints} gross)`}
          >
            <div className="pi-card__cap-pill pi-card__cap-pill--used" title={`Used Capacity: ${piCapacityTotals.totalAssignedPoints} points`}>
              <span className="pi-card__cap-label">Used:</span>
              <strong className="pi-card__cap-val">{piCapacityTotals.totalAssignedPoints}</strong>
              <span className="pi-card__cap-unit">pts</span>
            </div>

            <div className="pi-card__cap-pill pi-card__cap-pill--total" title={`Total Available Capacity: ${piCapacityTotals.totalCapacityPoints} points (Gross: ${piCapacityTotals.grossCapacityPoints} pts)`}>
              <span className="pi-card__cap-label">Total:</span>
              <strong className="pi-card__cap-val">{piCapacityTotals.totalCapacityPoints}</strong>
              <span className="pi-card__cap-unit">pts</span>
            </div>

            <div
              className={`pi-card__cap-pill pi-card__cap-pill--reserved${piCapacityTotals.totalReservedPoints === 0 ? " is-zero" : ""}`}
              title={
                piCapacityTotals.totalReservedPoints > 0
                  ? `Reserved Capacity: ${piCapacityTotals.totalReservedPoints} points`
                  : "No capacity reserved"
              }
            >
              {piCapacityTotals.totalReservedPoints > 0 && <ShieldAlert size={12} />}
              <span className="pi-card__cap-label">Reserved:</span>
              <strong className="pi-card__cap-val">{piCapacityTotals.totalReservedPoints}</strong>
              <span className="pi-card__cap-unit">pts</span>
            </div>

            {piCapacityTotals.hasCapacity && (
              <div
                className="pi-card__cap-progress-wrap"
                title={`${piCapacityTotals.percent}% committed (${piCapacityTotals.remainingCapacityPoints} pts available)`}
              >
                <div className="pi-card__cap-progress-bar">
                  <div
                    className={`pi-card__cap-progress-fill${
                      piCapacityTotals.isOverCapacity
                        ? " is-danger"
                        : piCapacityTotals.percent >= 90
                        ? " is-warning"
                        : " is-normal"
                    }`}
                    style={{ width: `${Math.min(100, piCapacityTotals.percent)}%` }}
                  />
                </div>
                <span className={`pi-card__cap-progress-text${piCapacityTotals.isOverCapacity ? " is-danger" : ""}`}>
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
            className={`pi-card__reserve-btn${reservationsCount > 0 ? " has-reservations" : ""}`}
            onClick={() => setIsManagingReservations(true)}
            title="Manage Capacity Reservations for this PI"
          >
            <ShieldAlert size={13} />
            <span>Reserve Capacity{reservationsCount > 0 ? ` (${reservationsCount})` : ""}</span>
          </button>
        )}

        {isConfirmingDelete ? (
          <span className="pi-card__confirm-delete">
            Delete this PI and all its sprints?
            <button type="button" className="pi-card__confirm-yes" onClick={onDelete}>
              Yes
            </button>
            <button type="button" className="pi-card__confirm-no" onClick={() => setIsConfirmingDelete(false)}>
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
                onMoveUp={() => onMoveSprint(sprint.id, "up")}
                onMoveDown={() => onMoveSprint(sprint.id, "down")}
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

interface SprintBoardColumnProps {
  sprint: Sprint;
  range?: { startDate: string; endDate: string };
  items: RequirementItem[];
  requirements: RequirementsDocument;
  milestones?: Milestone[];
  team?: TeamDocument;
  backlogItems: RequirementItem[];
  conflictSeverityByItemId: Map<string, { severity: ScheduleConflictSeverity; blocker: RequirementItem }>;
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

function SprintBoardColumn({
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
        activeSprintReservations
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
      sprintRangesByItemId
    );
  }, [draggedItemId, sprint.id, range, requirements.items, requirements.relationships, requirements.relationshipTypes, requirements.itemTypes, sprintRangesByItemId]);

  const isBlocked = dropConflict?.severity === "blocked";
  const isAtRisk = dropConflict?.severity === "risk";

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
      e.dataTransfer.dropEffect = "none";
    } else {
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    const itemId = e.dataTransfer.getData("text/plain") || draggedItemId;
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
      className={`pi-board-column${isBlocked ? " is-blocked" : ""}${isAtRisk ? " is-at-risk" : ""}${isDragOver ? (isBlocked ? " is-drag-over-blocked" : isAtRisk ? " is-drag-over-risk" : " is-drag-over") : ""}`}
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
            title={`${items.length} requirement item${items.length === 1 ? "" : "s"} assigned`}
          >
            {items.length}
          </span>
          <SprintQuickAdd
            backlogItems={backlogItems}
            requirements={requirements}
            onAssign={(itemId) => onDropItem(itemId, sprint.id)}
          />
        </div>
        <div className="pi-board-column__meta">
          <span className="pi-board-column__dates">
            {range ? `${range.startDate} → ${range.endDate}` : "—"}
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
                    {m.version && <span className="pi-board-column__milestone-ver">v{m.version}</span>}
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
                      {rel.completedRelatedItemsCount}/{rel.totalRelatedItemsCount} ({rel.completionPercentage}%)
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
                  title={`External Dependency: ${dep.id} ${dep.title || ""}`}
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
                    className={`pi-board-column__epic-progress-card${isComplete ? " is-complete" : ""}`}
                    onClick={() => onSelectItem(epicInfo.epic.id)}
                    title={`Epic: ${epicInfo.epic.id} - ${epicInfo.epic.title || "Untitled"}\n${epicInfo.completedChildrenCount}/${epicInfo.totalChildrenCount} completed (${epicInfo.completionPercentage}%)\n${epicInfo.itemsInSprint.length} item(s) in this sprint`}
                  >
                    <div className="pi-board-column__epic-progress-header">
                      <span className="pi-board-column__epic-progress-title">
                        <span style={{ color: "#a78bfa" }}>⚡</span>
                        <span>{epicInfo.epic.id}</span>
                        {epicInfo.epic.title && (
                          <span className="pi-board-column__epic-progress-name">
                            {epicInfo.epic.title}
                          </span>
                        )}
                      </span>
                      <span className="pi-board-column__epic-progress-metrics">
                        {epicInfo.completedChildrenCount}/{epicInfo.totalChildrenCount} ({epicInfo.completionPercentage}%)
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
          className={`pi-board-column__blocked-banner${isAtRisk ? " is-risk" : ""}`}
          title={
            isAtRisk
              ? `Same sprint as its blocker ${dropConflict.blocker.id}${dropConflict.blocker.title ? ` (${dropConflict.blocker.title})` : ""} - allowed, but make sure ${dropConflict.blocker.id} is done first.`
              : dropConflict.blockerRange
                ? `Can't schedule here - blocked by ${dropConflict.blocker.id}${dropConflict.blocker.title ? ` (${dropConflict.blocker.title})` : ""}, which isn't finished until ${dropConflict.blockerRange.endDate}.`
                : `Can't schedule here - blocked by ${dropConflict.blocker.id}${dropConflict.blocker.title ? ` (${dropConflict.blocker.title})` : ""}, which isn't scheduled yet.`
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
        {items.length === 0 ? (
          <div className="pi-board-column__empty">
            {isBlocked
              ? `Cannot add: blocked by ${dropConflict?.blocker.id}`
              : isDragOver
                ? "Drop to assign to sprint"
                : "No requirements assigned"}
          </div>
        ) : (
          items.map((item) => {
            const type = getItemType(requirements, item.typeId);
            const category = item.categoryId
              ? requirements.categories.find((c) => c.id === item.categoryId)
              : undefined;
            const isDragging = draggedItemId === item.id;
            const conflictInfo = conflictSeverityByItemId.get(item.id);
            const isConflicted = conflictInfo?.severity === "blocked";
            const isAtRisk = conflictInfo?.severity === "risk";
            const isBlocker = blockingItemIds.has(item.id);
            const parentEpic = parentEpicByItemId?.get(item.id);
            const isFilteredOut = filteredChildItemIds && !filteredChildItemIds.has(item.id);
            if (isFilteredOut) return null;
            return (
              <div
                key={item.id}
                className={`pi-board-item${isDragging ? " is-dragging" : ""}${isConflicted ? " is-conflicted" : ""}${isAtRisk ? " is-at-risk" : ""}${isBlocker ? " is-blocker-highlight" : ""}`}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", item.id);
                  e.dataTransfer.effectAllowed = "move";
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
                  if (e.key === "Enter" || e.key === " ") {
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
                      color: type?.color ?? "var(--chrome-text-dim)",
                      borderColor: `${type?.color ?? "var(--chrome-border)"}66`,
                    }}
                  >
                    {item.id}
                  </span>
                  {parentEpic && (
                    <span
                      className="pi-board-item__epic-badge"
                      title={`Epic: ${parentEpic.id} ${parentEpic.title || ""}`}
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
                      aria-label={`Blocked by ${conflictInfo?.blocker.id}${conflictInfo?.blocker.title ? ` (${conflictInfo.blocker.title})` : ""} - move this or its blocker to a different sprint to resolve`}
                    />
                  )}
                  {isAtRisk && (
                    <AlertTriangle
                      size={12}
                      className="pi-board-item__risk-warning"
                      aria-label={`Same sprint as its blocker ${conflictInfo?.blocker.id}${conflictInfo?.blocker.title ? ` (${conflictInfo.blocker.title})` : ""} - make sure that's done first`}
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
                <div className="pi-board-item__title">{item.title || "Untitled"}</div>
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

function SprintRow({
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
        <button type="button" disabled={isFirst} onClick={onMoveUp} aria-label="Move sprint earlier">
          <ChevronUp size={12} />
        </button>
        <button type="button" disabled={isLast} onClick={onMoveDown} aria-label="Move sprint later">
          <ChevronDown size={12} />
        </button>
      </div>
      <input className="sprint-row__name" value={sprint.name} onChange={(e) => onUpdateName(e.target.value)} />
      <span className="sprint-row__start" title="Computed automatically from this PI's start date and every earlier sprint's length">
        {range?.startDate ?? "—"}
      </span>
      <span className="sprint-row__arrow">→</span>
      <input
        type="date"
        className="sprint-row__end"
        value={range?.endDate ?? ""}
        onChange={(e) => onUpdateEnd(e.target.value)}
      />
      <span className="sprint-row__duration">{sprint.durationDays}d</span>
      {sprintSummary.directMilestones.length > 0 && (
        <span
          className="sprint-row__milestone-badge"
          title={`${sprintSummary.directMilestones.length} milestone(s) in sprint: ${sprintSummary.directMilestones.map((m) => m.name).join(", ")}`}
        >
          ◆ {sprintSummary.directMilestones.length}
        </span>
      )}
      {sprintSummary.impactedReleases.length > 0 && (
        <span
          className="sprint-row__release-badge"
          title={`Impacts ${sprintSummary.impactedReleases.length} release(s): ${sprintSummary.impactedReleases.map((r) => r.milestone.name).join(", ")}`}
        >
          📦 {sprintSummary.impactedReleases.length}
        </span>
      )}
      {sprintSummary.impactedEpics.length > 0 && (
        <span
          className="sprint-row__epic-badge"
          title={`Contains work for ${sprintSummary.impactedEpics.length} epic(s): ${sprintSummary.impactedEpics.map((e) => `${e.epic.id} (${e.completedChildrenCount}/${e.totalChildrenCount})`).join(", ")}`}
        >
          ⚡ {sprintSummary.impactedEpics.length}
        </span>
      )}
      {itemCount > 0 && (
        <span className="sprint-row__item-count" title={`${itemCount} requirement item${itemCount === 1 ? "" : "s"} assigned`}>
          {itemCount}
        </span>
      )}
      <button type="button" className="sprint-row__delete" onClick={onDelete} aria-label={`Delete ${sprint.name}`}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}
