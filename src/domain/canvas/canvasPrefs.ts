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
