// Namespaced to avoid colliding with anything else that might use this
// browser's localStorage for this origin - same convention as
// presenceIdentity.ts's own keys.
const SIGNALING_URLS_KEY = "system-design-editor:signaling-urls";

/**
 * Reads this person's own, runtime-configured signaling server URL(s),
 * if they've ever set one - stored as a single, comma-separated string,
 * the same format VITE_SIGNALING_URL itself uses.
 *
 * Returns null (not an empty array) when nothing's been saved, so a
 * caller can distinguish "never configured, fall back to whatever
 * VITE_SIGNALING_URL set at build time" from "deliberately cleared to
 * nothing" - collapsing both to the same empty-array result would make
 * it impossible to ever fall back to the build-time default again once
 * a user had explicitly cleared their own override.
 *
 * This exists specifically so a deployed, static build doesn't have to
 * be rebuilt every time the signaling server it should point at
 * changes - VITE_SIGNALING_URL bakes a value into the JS bundle at
 * build time, which is fine as a deployer-chosen default, but is a
 * genuinely awkward way to handle something that can legitimately
 * change independently of the app's own code (a self-hosted signaling
 * server moving, a new one being stood up, etc.). This is that value's
 * runtime override, editable from within the app itself (see
 * CollabPanel), with no rebuild required.
 */
export function loadSignalingUrls(): string | null {
  try {
    return localStorage.getItem(SIGNALING_URLS_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists this person's own signaling server URL override. Pass an
 * empty string (not null - localStorage itself has no way to store
 * null) to explicitly clear it and fall back to VITE_SIGNALING_URL
 * again. Failures (quota exceeded, private-browsing storage
 * restrictions, etc.) are silently swallowed, same as
 * presenceIdentity.ts's own save functions - this is a convenience,
 * not a guarantee.
 */
export function saveSignalingUrls(raw: string): void {
  try {
    localStorage.setItem(SIGNALING_URLS_KEY, raw);
  } catch {
    // Same reasoning as above - silently skip this save.
  }
}

/**
 * Parses a comma-separated signaling URL string (from either
 * VITE_SIGNALING_URL or this module's own loadSignalingUrls) into the
 * array startCollabSession actually expects - trimming whitespace
 * around each entry and dropping any that end up empty (a trailing
 * comma, accidental double comma, etc. shouldn't produce a bogus empty
 * URL entry in the result).
 */
export function parseSignalingUrls(raw: string): string[] {
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}
