// Per-person display preferences for the Plan board. Stored in this
// browser's localStorage, keyed per document, and never written to the
// shared document - one collaborator collapsing the backlog or narrowing
// the board to a sprint must not change anyone else's view. Same
// namespacing and "a convenience, never a blocker" error handling as
// requirementsViewPrefs.ts.

import { SHOW_EVERYTHING, type BoardFilter } from './boardFilter';

export interface PlanBoardPrefs {
  /** The backlog column is folded down to its rail. */
  backlogCollapsed?: boolean;
  /** Which program increment and sprints are showing - see boardFilter.ts. */
  filter?: BoardFilter;
}

const KEY_PREFIX = 'system-design-editor:plan-board:';

function keyFor(documentId: string | undefined): string {
  return `${KEY_PREFIX}${documentId ?? 'default'}`;
}

/** Anything that is not a well-formed filter becomes "show everything". */
export function normalizeBoardFilter(value: unknown): BoardFilter {
  if (!value || typeof value !== 'object') return SHOW_EVERYTHING;
  const { piId, sprintIds } = value as { piId?: unknown; sprintIds?: unknown };
  if (typeof piId !== 'string' || piId === '') return SHOW_EVERYTHING;
  const ids =
    Array.isArray(sprintIds) && sprintIds.every((id) => typeof id === 'string')
      ? (sprintIds as string[])
      : [];
  return { piId, sprintIds: ids };
}

/** Returns {} for a missing, unreadable or malformed entry - including
 * outside a browser, where localStorage doesn't exist at all. Each field is
 * validated on its own, so one bad field doesn't discard the other. */
export function loadPlanBoardPrefs(documentId?: string): PlanBoardPrefs {
  try {
    const raw = localStorage.getItem(keyFor(documentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prefs: PlanBoardPrefs = {};
    if (typeof parsed.backlogCollapsed === 'boolean') {
      prefs.backlogCollapsed = parsed.backlogCollapsed;
    }
    if ('filter' in parsed) prefs.filter = normalizeBoardFilter(parsed.filter);
    return prefs;
  } catch {
    return {};
  }
}

/** Merges `patch` into whatever is already stored for this document.
 * Failures (quota, private browsing) are silently skipped. */
export function savePlanBoardPrefs(documentId: string | undefined, patch: PlanBoardPrefs): void {
  try {
    const next = { ...loadPlanBoardPrefs(documentId), ...patch };
    localStorage.setItem(keyFor(documentId), JSON.stringify(next));
  } catch {
    // A preference that fails to save just isn't remembered next time.
  }
}
