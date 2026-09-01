import type { DiagramFile } from "./serialization";
import { parseDiagramFile } from "./serialization";

// Namespaced to avoid colliding with anything else that might use this
// browser's localStorage for this origin.
const AUTOSAVE_KEY = "system-design-editor:autosave";

/** Reads the auto-saved draft, if one exists and is readable. Returns
 * null (rather than throwing) for a missing, corrupted, or otherwise
 * unparseable entry - a bad autosave should never block the app from
 * starting, it should just be treated as if there wasn't one. */
export function loadAutosave(): DiagramFile | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return parseDiagramFile(raw);
  } catch {
    return null;
  }
}

/** Persists the current diagram as the auto-saved draft. Failures (quota
 * exceeded, private-browsing storage restrictions, etc.) are swallowed -
 * autosave is a convenience on top of explicit Save, not a guarantee, so
 * a failure here shouldn't surface as a user-facing error or block
 * anything else from working. */
export function saveAutosave(file: DiagramFile): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(file));
  } catch {
    // Same reasoning as above - silently skip this save.
  }
}
