import { useState } from "react";
import { CalendarRange, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  computeSprintDateRanges,
  updatePIStartDate,
  updateSprintEndDate,
  type ProgramIncrement,
  type Sprint,
} from "../../domain/programIncrements";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface TimelineViewProps {
  programIncrements: ProgramIncrement[];
  onUpdateProgramIncrements: (updater: (pis: ProgramIncrement[]) => ProgramIncrement[]) => void;
  requirements: RequirementsDocument;
  onUpdateRequirements: (updater: (doc: RequirementsDocument) => RequirementsDocument) => void;
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

export function TimelineView({ programIncrements, onUpdateProgramIncrements, requirements, onUpdateRequirements }: TimelineViewProps) {
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

  // Counted once per render rather than filtered separately inside every
  // SprintRow - a single pass over requirements.items builds a lookup all
  // sprint rows share, instead of each one re-scanning the full item list.
  const itemCountBySprintId = new Map<string, number>();
  for (const item of requirements.items) {
    if (!item.sprintId) continue;
    itemCountBySprintId.set(item.sprintId, (itemCountBySprintId.get(item.sprintId) ?? 0) + 1);
  }

  return (
    <div className="timeline-view">
      <div className="timeline-view__toolbar">
        <button type="button" className="timeline-view__add-pi" onClick={onAddPI}>
          <Plus size={13} />
          Program Increment
        </button>
      </div>

      <div className="timeline-view__content">
        {programIncrements.length === 0 ? (
          <p className="timeline-view__empty">
            No program increments yet - add one above to start defining sprints.
          </p>
        ) : (
          programIncrements.map((pi) => (
            <ProgramIncrementCard
              key={pi.id}
              pi={pi}
              itemCountBySprintId={itemCountBySprintId}
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
    </div>
  );
}

interface ProgramIncrementCardProps {
  pi: ProgramIncrement;
  itemCountBySprintId: Map<string, number>;
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
  itemCountBySprintId,
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

      <div className="pi-card__sprints">
        {pi.sprints.map((sprint, index) => (
          <SprintRow
            key={sprint.id}
            sprint={sprint}
            range={rangeBySprintId.get(sprint.id)}
            itemCount={itemCountBySprintId.get(sprint.id) ?? 0}
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
    </section>
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
