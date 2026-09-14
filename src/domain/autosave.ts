import type { DiagramFile } from "./serialization";
import { parseDiagramFile } from "./serialization";
import { SchemaVersionError } from "./schemaMigrations.ts";
import {
  classifyStorageError,
  type StorageFailureReason,
} from "./documentStore.ts";

// Namespaced to avoid colliding with anything else that might use this
// browser's localStorage for this origin.
const AUTOSAVE_KEY = "system-design-editor:autosave";

/** Set when the stored autosave was written by a NEWER build than this one.
 *
 * That case has to be handled differently from ordinary corruption. A
 * corrupted entry is worthless and can be overwritten freely; an autosave from
 * a newer version is intact work that this build merely can't read, and
 * overwriting it on the next keystroke would destroy it permanently. So while
 * this flag is set, saveAutosave does nothing.
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
        `The auto-saved draft was written by a newer version of the ` +
        `application (file format ${error.fileVersion}, this build supports ` +
        `up to ${error.appVersion}). Auto-saving is paused so it isn't ` +
        `overwritten. Update the application to recover it.`;
      console.warn(autosaveBlockedReason);
    }
    return null;
  }
}

/** Persists the current diagram as the auto-saved draft. Failures (quota
 * exceeded, private-browsing storage restrictions, etc.) are swallowed -
 * autosave is a convenience on top of explicit Save, not a guarantee, so
 * a failure here shouldn't surface as a user-facing error or block
 * anything else from working. */
/** The last write failure, or null if the last write succeeded.
 *
 * Previously a failed save was swallowed entirely, so someone whose storage
 * was full or disabled kept working in the belief their changes were being
 * kept (WS2-R4). The failure is classified rather than reported raw, because
 * "no space left" and "storage is switched off" need different things said to
 * the user. */
let lastSaveFailure: { reason: StorageFailureReason; message: string } | null =
  null;

export function getAutosaveFailure(): {
  reason: StorageFailureReason;
  message: string;
} | null {
  return lastSaveFailure;
}

export function saveAutosave(file: DiagramFile): void {
  // Never clobber an intact draft this build simply can't read.
  if (autosaveBlockedReason !== null) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(file));
    lastSaveFailure = null;
  } catch (error) {
    const reason = classifyStorageError(error);
    lastSaveFailure = {
      reason,
      message:
        reason === "quota"
          ? "There is no space left to save. Export a copy before making more changes."
          : "This browser is not allowing storage, so changes are not being saved.",
    };
  }
}
