// Per-person display preferences for the diagram canvas. Stored in this
// browser's localStorage and never written to the document - one person
// hiding the minimap must not hide it for a collaborator. Same "a
// convenience, never a blocker" error handling as requirementsViewPrefs.ts.

const MINIMAP_KEY = 'system-design-editor:canvas:minimap';

/** Whether the minimap is shown. Off until someone turns it on: it covers a
 * corner of the diagram, and most diagrams fit on screen without it. */
export function loadShowMinimap(): boolean {
  try {
    return localStorage.getItem(MINIMAP_KEY) === 'shown';
  } catch {
    return false;
  }
}

export function saveShowMinimap(shown: boolean): void {
  try {
    localStorage.setItem(MINIMAP_KEY, shown ? 'shown' : 'hidden');
  } catch {
    // Storage is unavailable or full: the choice lasts until reload.
  }
}

const INSPECTOR_SECTIONS_KEY = 'system-design-editor:inspector:collapsed-sections';

/** Inspector sections folded when nothing has been stored: appearance is
 * set once and then left alone, so it starts out of the way. */
const DEFAULT_COLLAPSED_SECTIONS: readonly string[] = ['appearance'];

/** The ids of the Inspector sections this person has folded. */
export function loadCollapsedInspectorSections(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(INSPECTOR_SECTIONS_KEY);
    if (raw === null) return new Set(DEFAULT_COLLAPSED_SECTIONS);
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return new Set(parsed as string[]);
    }
  } catch {
    // Unreadable or unavailable: fall through to the defaults.
  }
  return new Set(DEFAULT_COLLAPSED_SECTIONS);
}

export function saveCollapsedInspectorSections(collapsed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(INSPECTOR_SECTIONS_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Storage is unavailable or full: the choice lasts until reload.
  }
}
