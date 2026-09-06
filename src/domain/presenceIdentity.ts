// Namespaced to avoid colliding with anything else that might use this
// browser's localStorage for this origin - same convention as
// autosave.ts's own AUTOSAVE_KEY.
const PRESENCE_NAME_KEY = "system-design-editor:presence-name";

/** Reads the person's own last-used display name for collaborative
 * sessions, if one was ever set. Returns null (rather than throwing)
 * for a missing entry or a storage failure - same reasoning as
 * autosave.ts's loadAutosave: this is a convenience, not something that
 * should ever block starting or joining a session. */
export function loadPresenceName(): string | null {
  try {
    return localStorage.getItem(PRESENCE_NAME_KEY);
  } catch {
    return null;
  }
}

/** Persists the person's chosen display name so they don't have to
 * retype it the next time they start or join a session. Failures (quota
 * exceeded, private-browsing storage restrictions, etc.) are silently
 * swallowed, same as autosave.ts's saveAutosave - this is a convenience,
 * not a guarantee. */
export function savePresenceName(name: string): void {
  try {
    localStorage.setItem(PRESENCE_NAME_KEY, name);
  } catch {
    // Same reasoning as above - silently skip this save.
  }
}
