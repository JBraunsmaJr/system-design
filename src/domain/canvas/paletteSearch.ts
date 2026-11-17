/**
 * Searching the palette, and remembering what was last used from it.
 *
 * The palette holds a few hundred things across six modes (system, cloud,
 * shapes, code, git, fragments), and finding one meant knowing which mode
 * it was filed under. A search goes across all of them at once.
 */

/** One draggable thing in the palette, whatever mode it lives in. */
export interface PaletteEntry {
  /** Unique across the whole palette: the drag type plus the item id. */
  key: string;
  /** What the drop handler reads for `mimeType`. */
  id: string;
  label: string;
  icon?: string;
  color: string;
  mimeType: string;
  /** Where it is filed, shown beside a search result: "Data", "AWS". */
  group: string;
}

export function paletteEntryKey(mimeType: string, id: string): string {
  return `${mimeType}:${id}`;
}

export const MAX_PALETTE_RESULTS = 40;

/**
 * Entries matching `query`, best first: a label that starts with it, then
 * a label with a word that starts with it, then a label containing it,
 * then anything filed under a matching group. Every word of the query has
 * to match somewhere, so "aws queue" finds SQS under AWS. Ties keep the
 * palette's own order.
 */
export function searchPalette(
  entries: readonly PaletteEntry[],
  query: string,
  limit = MAX_PALETTE_RESULTS,
): PaletteEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { entry: PaletteEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const label = entry.label.toLowerCase();
    const group = entry.group.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (label.startsWith(word)) score += 4;
      else if (label.split(/[^a-z0-9]+/).some((part) => part.startsWith(word))) score += 3;
      else if (label.includes(word)) score += 2;
      else if (group.includes(word)) score += 1;
      else return;
    }
    scored.push({ entry, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.entry);
}

export const MAX_RECENT_PALETTE_ENTRIES = 6;
const RECENT_KEY = 'system-design-editor:palette:recent';

/** Keys of the entries last dropped on a canvas, newest first. */
export function loadRecentPaletteKeys(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      return parsed
        .filter((v): v is string => typeof v === 'string')
        .slice(0, MAX_RECENT_PALETTE_ENTRIES);
    }
  } catch {
    // Unreadable or unavailable: nothing recent.
  }
  return [];
}

/** `keys` with `key` moved to the front, trimmed to the limit. */
export function withRecentPaletteKey(keys: readonly string[], key: string): string[] {
  return [key, ...keys.filter((k) => k !== key)].slice(0, MAX_RECENT_PALETTE_ENTRIES);
}

export function saveRecentPaletteKeys(keys: readonly string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(keys));
  } catch {
    // Storage is unavailable or full: the list lasts until reload.
  }
}
