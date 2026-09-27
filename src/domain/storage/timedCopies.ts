/**
 * Timed copies (WS13-R6): an opt-in download of the open document at a fixed
 * interval, for browsers that cannot save continuously to a file (Firefox).
 * With the browser set to save downloads without asking, copies accumulate
 * in the download folder with no further action.
 *
 * A preference, so it lives in localStorage (WS2-R1 allows small preference
 * keys). Off unless the user turns it on.
 */
export const TIMED_COPIES_KEY = 'system-design-editor:timed-copies';

/** Instrumented builds only: seconds instead of minutes, so the browser
 * suite does not wait minutes for a download. */
export const TIMED_COPIES_TEST_SECONDS_KEY = 'system-design-editor:timed-copies-test-seconds';

export const TIMED_COPY_INTERVALS = [5, 10, 15, 30, 60] as const;

export interface TimedCopiesSettings {
  enabled: boolean;
  minutes: number;
}

export const DEFAULT_TIMED_COPIES: TimedCopiesSettings = { enabled: false, minutes: 15 };

/** Anything unreadable, or outside 1-240 minutes, falls back to the default -
 * and in particular never turns the feature on by itself. */
export function parseTimedCopies(raw: string | null): TimedCopiesSettings {
  if (!raw) return DEFAULT_TIMED_COPIES;
  try {
    const value = JSON.parse(raw) as Partial<TimedCopiesSettings>;
    const minutes =
      typeof value.minutes === 'number' &&
      Number.isFinite(value.minutes) &&
      value.minutes >= 1 &&
      value.minutes <= 240
        ? Math.round(value.minutes)
        : DEFAULT_TIMED_COPIES.minutes;
    return { enabled: value.enabled === true, minutes };
  } catch {
    return DEFAULT_TIMED_COPIES;
  }
}

export function loadTimedCopies(): TimedCopiesSettings {
  try {
    return parseTimedCopies(localStorage.getItem(TIMED_COPIES_KEY));
  } catch {
    return DEFAULT_TIMED_COPIES;
  }
}

export function saveTimedCopies(settings: TimedCopiesSettings): void {
  try {
    localStorage.setItem(TIMED_COPIES_KEY, JSON.stringify(settings));
  } catch {
    // A preference that cannot be stored lasts for this visit only.
  }
}

/**
 * `<title>-<YYYY-MM-DD>T<HH-MM-SS>.json`, in local time. Sortable, safe on
 * every file system, and distinct per copy so none overwrites another.
 */
export function timedCopyFileName(title: string, at: Date): string {
  const safe =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'diagram';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  return `${safe}-${stamp}.json`;
}

/**
 * Whether a copy is due: only when the content differs from the last copy.
 * An idle document left open overnight should not fill the download folder.
 */
export function isCopyDue(current: string, lastCopied: string | null): boolean {
  return current !== lastCopied;
}
