// Per-person display preferences for the Requirements view (grouping
// mode now; collapsed cards later). Stored in this browser's
// localStorage, keyed per document, and never written to the shared
// document - one collaborator regrouping or collapsing their view must
// not change anyone else's. Same namespacing and "a convenience, never a
// blocker" error handling as presenceIdentity.ts.

export type RequirementsGroupBy = 'type' | 'category' | 'epic';

export interface RequirementsViewPrefs {
  groupBy?: RequirementsGroupBy;
}

const KEY_PREFIX = 'system-design-editor:requirements-view:';
const GROUP_BY_VALUES: readonly RequirementsGroupBy[] = ['type', 'category', 'epic'];

function keyFor(documentId: string | undefined): string {
  return `${KEY_PREFIX}${documentId ?? 'default'}`;
}

/** Returns {} for a missing, unreadable or malformed entry - including
 * outside a browser, where localStorage doesn't exist at all. */
export function loadRequirementsViewPrefs(documentId?: string): RequirementsViewPrefs {
  try {
    const raw = localStorage.getItem(keyFor(documentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prefs: RequirementsViewPrefs = {};
    if (GROUP_BY_VALUES.includes(parsed.groupBy as RequirementsGroupBy)) {
      prefs.groupBy = parsed.groupBy as RequirementsGroupBy;
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
