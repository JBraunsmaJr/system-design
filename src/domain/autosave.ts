import type { DiagramFile } from './serialization';
import { parseDiagramFile } from './serialization';
import { SchemaVersionError } from './schemaMigrations.ts';

// The retired localStorage slot (WS2-R1) - read once for import, then cleared.
const AUTOSAVE_KEY = 'system-design-editor:autosave';

/** Set when the stored autosave was written by a NEWER build than this one.
 *
 * That case has to be handled differently from ordinary corruption. A
 * corrupted entry is worthless and can be overwritten freely; an autosave from
 * a newer version is intact work that this build merely can't read, and
 * overwriting it on the next keystroke would destroy it permanently. So while
 * this flag is set, clearLegacyAutosave leaves it alone.
 *
 * This is deliberately conservative rather than pretty. WS2 replaces this
 * module with per-document IndexedDB storage, at which point a newer-version
 * document becomes an ordinary entry in the document list that this build
 * declines to open, instead of a single slot under contention. */
let autosaveBlockedReason: string | null = null;

/** Whether autosave is currently suspended to protect an unreadable entry.
 * Exposed so the UI can tell the user why their work isn't being saved,
 * rather than leaving them to discover it. */
export function getAutosaveBlockedReason(): string | null {
  return autosaveBlockedReason;
}

/** Reads the auto-saved draft, if one exists and is readable. Returns
 * null (rather than throwing) for a missing, corrupted, or otherwise
 * unparseable entry - a bad autosave should never block the app from
 * starting, it should just be treated as if there wasn't one. */
export function loadAutosave(): DiagramFile | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const file = parseDiagramFile(raw);
    autosaveBlockedReason = null;
    return file;
  } catch (error) {
    if (error instanceof SchemaVersionError) {
      autosaveBlockedReason =
        `An older auto-saved draft in this browser was written by a newer ` +
        `version of the application (file format ${error.fileVersion}, this ` +
        `build supports up to ${error.appVersion}). It has been left in place ` +
        `untouched; update the application to recover it.`;
      console.warn(autosaveBlockedReason);
    }
    return null;
  }
}

/**
 * Removes the legacy draft once its content is safely in a stored document.
 *
 * The localStorage slot is retired (WS2-R1): documents persist to IndexedDB,
 * per document. This module now only READS the old slot, once, so a browser
 * upgrading from a build that used it opens with that work, and then clears
 * it. A draft this build cannot read (written by a newer version) is never
 * cleared - it is intact work that a newer build can still recover.
 */
export function clearLegacyAutosave(): void {
  if (autosaveBlockedReason !== null) return;
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Storage unavailable: there is nothing to clear, and nothing to warn about.
  }
}

/** Whether a legacy draft is still present, readable or not. */
export function hasLegacyAutosave(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== null;
  } catch {
    return false;
  }
}
