import { useMemo, useState, useRef } from "react";
import { AlertTriangle, CalendarRange, ChevronDown, ChevronRight, ChevronUp, GanttChartSquare, Inbox, Plus, Trash2 } from "lucide-react";
import {
  computeSprintDateRanges,
  updatePIStartDate,
  updateSprintEndDate,
  type ProgramIncrement,
  type Sprint,
} from "../../domain/programIncrements";
import { addRelationship, getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import { findScheduleConflicts, checkScheduleConflict, findBlockingItemIds } from "../../domain/scheduleConflicts";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import type { TeamDocument } from "../../domain/teamTypes";
import type { SubDiagram } from "../../domain/types";
import type { DiagramPath } from "../../domain/subDiagramTree";
import { computeSprintCapacity } from "../../domain/teamCapacity";
import { SprintCapacityBar } from "../team/SprintCapacityBar";
import { MemberPicker } from "../team/MemberPicker";
import { PointsPicker } from "../team/PointsPicker";
import { RequirementDetailModal } from "./RequirementDetailModal";
import { GanttChart } from "./GanttChart";
import { SprintQuickAdd } from "./SprintQuickAdd";

interface TimelineViewProps {
  programIncrements: ProgramIncrement[];
  onUpdateProgramIncrements: (updater: (pis: ProgramIncrement[]) => ProgramIncrement[]) => void;
  requirements: RequirementsDocument;
  onUpdateRequirements: (updater: (doc: RequirementsDocument) => RequirementsDocument) => void;
  team?: TeamDocument;
  diagramRoot?: SubDiagram;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

const DEFAULT_SPRINT_DURATION_DAYS = 14;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TimelineView({
  programIncrements,
  onUpdateProgramIncrements,
  requirements,
  onUpdateRequirements,
  team,
  diagramRoot,
  onNavigateToNode,
  onCreateLinkedNode,
  onNavigateToRequirement,
}: TimelineViewProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<"board" | "gantt">("board");
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  const onAddPI = () => {
    const newPI: ProgramIncrement = {
      id: nextId("pi"),
      name: `PI ${programIncrements.length + 1}`,
      startDate: todayISO(),
      sprints: [{ id: nextId("sprint"), name: "Sprint 1", durationDays: DEFAULT_SPRINT_DURATION_DAYS }],
    };
    onUpdateProgramIncrements((pis) => [...pis, newPI]);
  };

  const onUpdatePIName = (piId: string, name: string) => {
    onUpdateProgramIncrements((pis) => pis.map((pi) => (pi.id === piId ? { ...pi, name } : pi)));
  };

  const onUpdatePIStart = (piId: string, startDate: string) => {
    onUpdateProgramIncrements((pis) => pis.map((pi) => (pi.id === piId ? updatePIStartDate(pi, startDate) : pi)));
  };

  // Deletes the whole PI and unassigns any requirement items that were in
  // any of its sprints - two separate state updates (program increments,
  // then requirements), but both happen synchronously within this one
  // handler, well under the undo history's debounce window, so they still
  // land as a single undo step rather than two.
  const onDeletePI = (piId: string) => {
    const pi = programIncrements.find((p) => p.id === piId);
    if (!pi) return;
    const sprintIds = new Set(pi.sprints.map((s) => s.id));
    onUpdateProgramIncrements((pis) => pis.filter((p) => p.id !== piId));
    onUpdateRequirements((doc) => ({
      ...doc,
      items: doc.items.map((item) => (item.sprintId && sprintIds.has(item.sprintId) ? { ...item, sprintId: undefined } : item)),
    }));
  };

  const onAddSprint = (piId: string) => {
    onUpdateProgramIncrements((pis) =>
      pis.map((pi) =>
        pi.id === piId
          ? {
              ...pi,
              sprints: [
                ...pi.sprints,
                { id: nextId("sprint"), name: `Sprint ${pi.sprints.length + 1}`, durationDays: DEFAULT_SPRINT_DURATION_DAYS },
              ],
            }
          : pi
      )
    );
  };

  const onUpdateSprintName = (piId: string, sprintId: string, name: string) => {
    onUpdateProgramIncrements((pis) =>
      pis.map((pi) =>
        pi.id === piId ? { ...pi, sprints: pi.sprints.map((s) => (s.id === sprintId ? { ...s, name } : s)) } : pi
      )
    );
  };

  const onUpdateSprintEnd = (piId: string, sprintId: string, newEndDate: string) => {
    onUpdateProgramIncrements((pis) => pis.map((pi) => (pi.id === piId ? updateSprintEndDate(pi, sprintId, newEndDate) : pi)));
  };

  const onDeleteSprint = (piId: string, sprintId: string) => {
    onUpdateProgramIncrements((pis) =>
      pis.map((pi) => (pi.id === piId ? { ...pi, sprints: pi.sprints.filter((s) => s.id !== sprintId) } : pi))
    );
    onUpdateRequirements((doc) => ({
      ...doc,
      items: doc.items.map((item) => (item.sprintId === sprintId ? { ...item, sprintId: undefined } : item)),
    }));
  };

  const onMoveSprint = (piId: string, sprintId: string, direction: "up" | "down") => {
    onUpdateProgramIncrements((pis) =>
      pis.map((pi) => {
        if (pi.id !== piId) return pi;
        const index = pi.sprints.findIndex((s) => s.id === sprintId);
        const swapWith = direction === "up" ? index - 1 : index + 1;
        if (index === -1 || swapWith < 0 || swapWith >= pi.sprints.length) return pi;
        const sprints = [...pi.sprints];
        [sprints[index], sprints[swapWith]] = [sprints[swapWith], sprints[index]];
        return { ...pi, sprints };
      })
    );
  };

  const onUpdateItem = (id: string, patch: Partial<RequirementItem>) => {
    onUpdateRequirements((doc) => ({
      ...doc,
      items: doc.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  const onDeleteItem = (id: string) => {
    onUpdateRequirements((doc) => ({
      ...doc,
      items: doc.items.filter((item) => item.id !== id),
      // Same "orphaned reference" cleanup as RequirementsView's own
      // onDeleteItem - a relationship touching this item on either side
      // would otherwise be left pointing at an id that no longer exists.
      relationships: doc.relationships.filter((r) => r.fromItemId !== id && r.toItemId !== id),
    }));
  };

  const onCreateAndAssignCategory = (itemId: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    onUpdateRequirements((doc) => {
      const existing = doc.categories.find((c) => c.label.toLowerCase() === trimmed.toLowerCase());
      if (existing) {
        return {
          ...doc,
          items: doc.items.map((item) => (item.id === itemId ? { ...item, categoryId: existing.id } : item)),
        };
      }
      const newCategory = {
        id: `cat-${Date.now().toString(36)}`,
        label: trimmed,
        color: "#22B8CF",
      };
      return {
        ...doc,
        categories: [...doc.categories, newCategory],
        items: doc.items.map((item) => (item.id === itemId ? { ...item, categoryId: newCategory.id } : item)),
      };
    });
  };

  const onMoveItemToSprint = (itemId: string, targetSprintId: string): string | null => {
    const targetRange = allSprintRangesById.get(targetSprintId);
    if (targetRange) {
      const conflict = checkScheduleConflict(
        itemId,
        targetRange,
        requirements.items,
        requirements.relationships,
        requirements.relationshipTypes,
        sprintRangesByItemId
      );
      if (conflict) {
        return conflict.blockerRange
          ? `Can't schedule here - blocked by ${conflict.blocker.id}, which isn't finished until ${conflict.blockerRange.endDate}.`
          : `Can't schedule here - blocked by ${conflict.blocker.id}, which isn't scheduled yet.`;
      }
    }
    onUpdateRequirements((doc) => ({
      ...doc,
      items: doc.items.map((item) => (item.id === itemId ? { ...item, sprintId: targetSprintId } : item)),
    }));
    return null;
  };

  const onAddRelationship = (typeId: string, fromItemId: string, toItemId: string): string | null => {
    const result = addRelationship(requirements, typeId, fromItemId, toItemId);
    if (result.error) return result.error;
    onUpdateRequirements((doc) => ({ ...doc, relationships: result.relationships }));
    return null;
  };

  const onDeleteRelationship = (relationshipId: string) => {
    onUpdateRequirements((doc) => ({ ...doc, relationships: doc.relationships.filter((r) => r.id !== relationshipId) }));
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
  const { allSprintRangesById, sprintRangesByItemId, conflictedItemIds } = useMemo(() => {
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
      byItemId
    );
    return {
      allSprintRangesById: allRanges,
      sprintRangesByItemId: byItemId,
      conflictedItemIds: new Set(conflicts.map((c) => c.item.id)),
    };
  }, [programIncrements, requirements]);
  const onUnassignItem = (itemId: string) => onUpdateItem(itemId, { sprintId: undefined });

  const blockingItemIds = useMemo(() => {
    if (!draggedItemId) return new Set<string>();
    return findBlockingItemIds(
      draggedItemId,
      requirements.relationships,
      requirements.relationshipTypes
    );
  }, [draggedItemId, requirements.relationships, requirements.relationshipTypes]);

  return (
    <div className="timeline-view">
      <div className="timeline-view__toolbar">
        <button type="button" className="timeline-view__add-pi" onClick={onAddPI}>
          <Plus size={13} />
          Program Increment
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
      </div>

      {chartMode === "gantt" ? (
        <GanttChart
          programIncrements={programIncrements}
          requirements={requirements}
          onSelectItem={(id) => setSelectedItemId(id)}
          onNavigateToRequirement={onNavigateToRequirement}
        />
      ) : (
      <div className="timeline-view__content">
        {backlogItems.length > 0 && (
          <BacklogSection
            items={backlogItems}
            requirements={requirements}
            team={team}
            draggedItemId={draggedItemId}
            blockingItemIds={blockingItemIds}
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
              team={team}
              itemsBySprintId={itemsBySprintId}
              backlogItems={backlogItems}
              conflictedItemIds={conflictedItemIds}
              draggedItemId={draggedItemId}
              blockingItemIds={blockingItemIds}
              sprintRangesByItemId={sprintRangesByItemId}
              onSelectItem={(id) => setSelectedItemId(id)}
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
          team={team}
          diagramRoot={diagramRoot}
          onNavigateToNode={onNavigateToNode}
          onCreateLinkedNode={onCreateLinkedNode}
          onClose={() => setSelectedItemId(null)}
          onUpdateItem={onUpdateItem}
          onDeleteItem={onDeleteItem}
          onNavigateToRequirement={onNavigateToRequirement}
          onSelectItem={(id) => setSelectedItemId(id)}
          onCreateAndAssignCategory={onCreateAndAssignCategory}
          onAddRelationship={onAddRelationship}
          onDeleteRelationship={onDeleteRelationship}
        />
      )}
    </div>
  );
}

interface BacklogSectionProps {
  items: RequirementItem[];
  requirements: RequirementsDocument;
  team?: TeamDocument;
  draggedItemId: string | null;
  blockingItemIds?: Set<string>;
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
  const filteredItems =
    q === "" ? items : items.filter((item) => item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q));

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
            <p className="backlog-section__empty">No items match "{query.trim()}".</p>
          ) : (
            filteredItems.map((item) => {
              const type = getItemType(requirements, item.typeId);
              const category = item.categoryId ? requirements.categories.find((c) => c.id === item.categoryId) : undefined;
              const isDragging = draggedItemId === item.id;
              const isBlocker = blockingItemIds?.has(item.id);
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
                    {team && (
                      <MemberPicker
                        team={team}
                        assigneeId={item.assigneeId}
                        compact={true}
                        onAssign={(assigneeId) => onUpdateItem(item.id, { assigneeId })}
                        onClear={() => onUpdateItem(item.id, { assigneeId: undefined })}
                      />
                    )}
                    <PointsPicker
                      points={item.points}
                      compact={true}
                      onChange={(points) => onUpdateItem(item.id, { points })}
                    />
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
  team?: TeamDocument;
  itemsBySprintId: Map<string, RequirementItem[]>;
  backlogItems: RequirementItem[];
  conflictedItemIds: Set<string>;
  draggedItemId: string | null;
  blockingItemIds: Set<string>;
  sprintRangesByItemId: Map<string, { startDate: string; endDate: string }>;
  onSelectItem: (itemId: string) => void;
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
}

function ProgramIncrementCard({
  pi,
  requirements,
  team,
  itemsBySprintId,
  backlogItems,
  conflictedItemIds,
  draggedItemId,
  blockingItemIds,
  sprintRangesByItemId,
  onSelectItem,
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
}: ProgramIncrementCardProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isSprintListCollapsed, setIsSprintListCollapsed] = useState(false);
  const ranges = computeSprintDateRanges(pi);
  const rangeBySprintId = new Map(ranges.map((r) => [r.sprintId, r]));

  return (
    <section className="pi-card">
      <div className="pi-card__header">
        <CalendarRange size={14} className="pi-card__icon" />
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
                team={team}
                backlogItems={backlogItems}
                conflictedItemIds={conflictedItemIds}
                draggedItemId={draggedItemId}
                blockingItemIds={blockingItemIds}
                sprintRangesByItemId={sprintRangesByItemId}
                onSelectItem={onSelectItem}
                onDragStartItem={onDragStartItem}
                onDragEndItem={onDragEndItem}
                onDropItem={onDropItem}
                onUpdateItem={onUpdateItem}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface SprintBoardColumnProps {
  sprint: Sprint;
  range?: { startDate: string; endDate: string };
  items: RequirementItem[];
  requirements: RequirementsDocument;
  team?: TeamDocument;
  backlogItems: RequirementItem[];
  conflictedItemIds: Set<string>;
  draggedItemId: string | null;
  blockingItemIds: Set<string>;
  sprintRangesByItemId: Map<string, { startDate: string; endDate: string }>;
  onSelectItem: (id: string) => void;
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
  team,
  backlogItems,
  conflictedItemIds,
  draggedItemId,
  blockingItemIds,
  sprintRangesByItemId,
  onSelectItem,
  onDragStartItem,
  onDragEndItem,
  onDropItem,
  onUpdateItem,
}: SprintBoardColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [dropError, setDropError] = useState<string | null>(null);
  const dropErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const capacitySummary = team
    ? computeSprintCapacity(sprint, range, team, requirements.items.filter((i) => isItemWorkable(requirements, i)))
    : null;

  const dropConflict = useMemo(() => {
    if (!draggedItemId || !range) return null;
    return checkScheduleConflict(
      draggedItemId,
      range,
      requirements.items,
      requirements.relationships,
      requirements.relationshipTypes,
      sprintRangesByItemId
    );
  }, [draggedItemId, range, requirements.items, requirements.relationships, requirements.relationshipTypes, sprintRangesByItemId]);

  const isBlocked = Boolean(dropConflict);

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
      className={`pi-board-column${isBlocked ? " is-blocked" : ""}${isDragOver ? (isBlocked ? " is-drag-over-blocked" : " is-drag-over") : ""}`}
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
      {dropConflict && (
        <div
          className="pi-board-column__blocked-banner"
          title={
            dropConflict.blockerRange
              ? `Can't schedule here - blocked by ${dropConflict.blocker.id}${dropConflict.blocker.title ? ` (${dropConflict.blocker.title})` : ""}, which isn't finished until ${dropConflict.blockerRange.endDate}.`
              : `Can't schedule here - blocked by ${dropConflict.blocker.id}${dropConflict.blocker.title ? ` (${dropConflict.blocker.title})` : ""}, which isn't scheduled yet.`
          }
        >
          <AlertTriangle size={12} className="pi-board-column__blocked-icon" />
          <span className="pi-board-column__blocked-text">
            {dropConflict.blockerRange
              ? `Blocked by ${dropConflict.blocker.id} (ends ${dropConflict.blockerRange.endDate})`
              : `Blocked by ${dropConflict.blocker.id} (unscheduled)`}
          </span>
        </div>
      )}
      {dropError && <p className="pi-board-column__drop-error">{dropError}</p>}
      <div className="pi-board-column__items">
        {items.length === 0 ? (
          <div className="pi-board-column__empty">
            {dropConflict
              ? `Cannot add: blocked by ${dropConflict.blocker.id}`
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
            const isConflicted = conflictedItemIds.has(item.id);
            const isBlocker = blockingItemIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`pi-board-item${isDragging ? " is-dragging" : ""}${isConflicted ? " is-conflicted" : ""}${isBlocker ? " is-blocker-highlight" : ""}`}
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
                      aria-label="Blocked by unfinished work - move this or its blocker to resolve"
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
                  {team && (
                    <MemberPicker
                      team={team}
                      assigneeId={item.assigneeId}
                      compact={true}
                      onAssign={(assigneeId) => onUpdateItem(item.id, { assigneeId })}
                      onClear={() => onUpdateItem(item.id, { assigneeId: undefined })}
                    />
                  )}
                  <PointsPicker
                    points={item.points}
                    compact={true}
                    onChange={(points) => onUpdateItem(item.id, { points })}
                  />
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
  isFirst: boolean;
  isLast: boolean;
  onUpdateName: (name: string) => void;
  onUpdateEnd: (endDate: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function SprintRow({ sprint, range, itemCount, isFirst, isLast, onUpdateName, onUpdateEnd, onDelete, onMoveUp, onMoveDown }: SprintRowProps) {
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
