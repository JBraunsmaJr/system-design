// Per-person display preferences for the Requirements view. Stored in this
// browser's localStorage, keyed per document, and never written to the
// shared document - one collaborator regrouping, collapsing or switching
// layout must not change anyone else's view. Same namespacing and "a
// convenience, never a blocker" error handling as presenceIdentity.ts.

export type RequirementsGroupBy = 'type' | 'category' | 'epic';
export type RequirementsLayout = 'list' | 'split';

export interface RequirementsViewPrefs {
  groupBy?: RequirementsGroupBy;
  layout?: RequirementsLayout;
  /** Items whose cards are collapsed to their header. By item id, so an
   * item shown twice (under two epics) is collapsed in both places. */
  collapsedIds?: string[];
  /** Epics (or other parents) whose children are folded away in the epic
   * grouping and the outline. */
  foldedIds?: string[];
  /** Outline sections folded in the split view, as "<groupBy>:<sectionKey>"
   * (e.g. "type:ticket", "epic:__no-epic__"), so each grouping keeps its
   * own folds. */
  collapsedSectionKeys?: string[];
  /** The relationship verb ("<typeId>::forward|backward") last used from a
   * card of each item type, so the Add relationship picker opens on it. */
  lastVerbByTypeId?: Record<string, string>;
}

const KEY_PREFIX = 'system-design-editor:requirements-view:';
const GROUP_BY_VALUES: readonly RequirementsGroupBy[] = ['type', 'category', 'epic'];
const LAYOUT_VALUES: readonly RequirementsLayout[] = ['list', 'split'];

function keyFor(documentId: string | undefined): string {
  return `${KEY_PREFIX}${documentId ?? 'default'}`;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;
}

/** Returns {} for a missing, unreadable or malformed entry - including
 * outside a browser, where localStorage doesn't exist at all. Each field is
 * validated on its own, so one bad field doesn't discard the rest. */
export function loadRequirementsViewPrefs(documentId?: string): RequirementsViewPrefs {
  try {
    const raw = localStorage.getItem(keyFor(documentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prefs: RequirementsViewPrefs = {};
    if (GROUP_BY_VALUES.includes(parsed.groupBy as RequirementsGroupBy)) {
      prefs.groupBy = parsed.groupBy as RequirementsGroupBy;
    }
    if (LAYOUT_VALUES.includes(parsed.layout as RequirementsLayout)) {
      prefs.layout = parsed.layout as RequirementsLayout;
    }
    const collapsedIds = stringArray(parsed.collapsedIds);
    if (collapsedIds) prefs.collapsedIds = collapsedIds;
    const foldedIds = stringArray(parsed.foldedIds);
    if (foldedIds) prefs.foldedIds = foldedIds;
    const collapsedSectionKeys = stringArray(parsed.collapsedSectionKeys);
    if (collapsedSectionKeys) prefs.collapsedSectionKeys = collapsedSectionKeys;
    const verbs = parsed.lastVerbByTypeId;
    if (verbs && typeof verbs === 'object' && !Array.isArray(verbs)) {
      prefs.lastVerbByTypeId = Object.fromEntries(
        Object.entries(verbs as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    }
    return prefs;
  } catch {
    return {};
  }
}

/** Merges `patch` into whatever is already stored for this document.
 * Failures (quota, private browsing) are silently skipped. */
export function saveRequirementsViewPrefs(
  documentId: string | undefined,
  patch: RequirementsViewPrefs,
): void {
  try {
    const next = { ...loadRequirementsViewPrefs(documentId), ...patch };
    localStorage.setItem(keyFor(documentId), JSON.stringify(next));
  } catch {
    // A preference that fails to save just isn't remembered next time.
  }
}
