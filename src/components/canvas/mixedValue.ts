/**
 * Reading one value out of a multi-selection for the Inspector, which
 * needs to tell "every item says X" apart from "they disagree".
 */

/** Marks a value that differs across a multi-selection. */
export const MIXED: unique symbol = Symbol('mixed');
export type Mixed<T> = T | typeof MIXED;

/**
 * The one value every item has, or MIXED. An empty list is MIXED too -
 * there's no value to show for nothing.
 */
export function sharedValue<T, V>(items: readonly T[], read: (item: T) => V): Mixed<V> {
    if (items.length === 0) return MIXED;
    const first = read(items[0]);
    for (let i = 1; i < items.length; i++) {
        if (read(items[i]) !== first) return MIXED;
    }
    return first;
}
