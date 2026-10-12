import type {RequirementItem} from './requirementsTypes';

/**
 * Tags on requirement items: free-form labels for filtering.
 *
 * A tag is matched ignoring case ("Security" and "security" are the same
 * tag) but keeps the spelling it was first written with. Whitespace is
 * trimmed and collapsed, and a tag is capped at MAX_TAG_LENGTH so a pasted
 * paragraph can't become one.
 */

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_ITEM = 30;

/** One tag cleaned up, or null if nothing is left. */
export function normalizeTag(raw: string): string | null {
    const tag = raw.replace(/\s+/g, ' ').trim().replace(/^#/, '').slice(0, MAX_TAG_LENGTH).trim();
    return tag ? tag : null;
}

export function tagKey(tag: string): string {
    return tag.toLowerCase();
}

/**
 * A stored or incoming tag list made safe to use: strings only, each
 * normalized, duplicates (ignoring case) dropped keeping the first, at
 * most MAX_TAGS_PER_ITEM. Returns undefined for anything that leaves no
 * tags - including a value that isn't an array at all, since tags come
 * from files and peers.
 */
export function normalizeTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of value) {
        if (typeof raw !== 'string') continue;
        const tag = normalizeTag(raw);
        if (!tag || seen.has(tagKey(tag))) continue;
        seen.add(tagKey(tag));
        result.push(tag);
        if (result.length >= MAX_TAGS_PER_ITEM) break;
    }
    return result.length > 0 ? result : undefined;
}

export function hasTag(item: Pick<RequirementItem, 'tags'>, tag: string): boolean {
    const key = tagKey(tag);
    return (item.tags ?? []).some((t) => tagKey(t) === key);
}

/** The item's tags with `tag` added (if it isn't already there), or
 * undefined when that leaves nothing - ready to pass as a patch. */
export function withTagAdded(tags: string[] | undefined, tag: string): string[] | undefined {
    return normalizeTags([...(tags ?? []), tag]);
}

export function withTagRemoved(tags: string[] | undefined, tag: string): string[] | undefined {
    const key = tagKey(tag);
    return normalizeTags((tags ?? []).filter((t) => tagKey(t) !== key));
}

/** Every tag used anywhere in `items`, once each (first spelling wins),
 * sorted alphabetically ignoring case - for the filter menu and the tag
 * editor's suggestions. */
export function collectTags(items: readonly Pick<RequirementItem, 'tags'>[]): string[] {
    const byKey = new Map<string, string>();
    for (const item of items) {
        for (const tag of item.tags ?? []) {
            const key = tagKey(tag);
            if (!byKey.has(key)) byKey.set(key, tag);
        }
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
}
