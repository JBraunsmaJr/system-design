/**
 * Which program increments and sprints the planning board shows (pure).
 *
 * Teams plan differently: some look at one sprint at a time, some at two or
 * three side by side, some at a whole program increment or at everything.
 * The board therefore shows everything by default and lets a person narrow
 * it - to one program increment, and within it to any set of sprints.
 *
 * The filter is a view preference, not document content: it is never
 * written to the document, never synced, and not undoable.
 */
import type { ProgramIncrement } from './programIncrements';

export interface BoardFilter {
  /** The one program increment showing, or null for all of them. */
  piId: string | null;
  /**
   * The sprints showing within `piId`. Empty means all of them, so "all"
   * has exactly one representation and a sprint added later is visible
   * without anyone having to check it.
   */
  sprintIds: readonly string[];
}

export const SHOW_EVERYTHING: BoardFilter = { piId: null, sprintIds: [] };

/** The program increment the filter names, if it still exists. */
export function filteredProgramIncrement(
  programIncrements: readonly ProgramIncrement[],
  filter: BoardFilter,
): ProgramIncrement | null {
  if (filter.piId === null) return null;
  return programIncrements.find((pi) => pi.id === filter.piId) ?? null;
}

/**
 * The program increments to render. A filter naming one that has since been
 * deleted (by this person or a collaborator) shows everything rather than an
 * empty board.
 */
export function visibleProgramIncrements(
  programIncrements: readonly ProgramIncrement[],
  filter: BoardFilter,
): readonly ProgramIncrement[] {
  const only = filteredProgramIncrement(programIncrements, filter);
  return only ? [only] : programIncrements;
}

/**
 * The sprint columns to render for `pi`, or null for all of them.
 *
 * Ids that no longer belong to the program increment are ignored, and a
 * selection left with nothing in it shows every sprint: deleting the one
 * sprint someone was focused on must not leave them looking at nothing.
 */
export function visibleSprintIds(pi: ProgramIncrement, filter: BoardFilter): Set<string> | null {
  if (filter.piId !== pi.id || filter.sprintIds.length === 0) return null;
  const known = new Set(pi.sprints.map((s) => s.id));
  const selected = filter.sprintIds.filter((id) => known.has(id));
  if (selected.length === 0 || selected.length === known.size) return null;
  return new Set(selected);
}

/** Narrow to one program increment (showing all its sprints), or back to all. */
export function selectProgramIncrement(piId: string | null): BoardFilter {
  return piId === null ? SHOW_EVERYTHING : { piId, sprintIds: [] };
}

/**
 * Check or uncheck one sprint of the filtered program increment.
 *
 * From "all sprints", checking one focuses on it alone - that is what someone
 * clicking a single sprint means, and checking more then adds them. Unchecking
 * the last one, or checking every one, returns to "all sprints".
 */
export function toggleSprint(
  filter: BoardFilter,
  pi: ProgramIncrement,
  sprintId: string,
): BoardFilter {
  if (!pi.sprints.some((s) => s.id === sprintId)) return filter;
  const current = visibleSprintIds(pi, { piId: pi.id, sprintIds: filter.sprintIds });
  const next = new Set(current ?? []);
  if (next.has(sprintId)) next.delete(sprintId);
  else next.add(sprintId);
  if (next.size === 0 || next.size === pi.sprints.length) return { piId: pi.id, sprintIds: [] };
  // In the program increment's own order, so the stored selection does not
  // depend on the order things were clicked in.
  return { piId: pi.id, sprintIds: pi.sprints.map((s) => s.id).filter((id) => next.has(id)) };
}
