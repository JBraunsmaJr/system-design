/**
 * Guards that make seeding safe to attempt more than once (WS1-R6, WS2-R2).
 *
 * Every seedYjs*Doc function writes an id into a Y.Map AND pushes that id onto
 * a companion ordering array. The map write is naturally idempotent - setting
 * the same key twice leaves one entry - but the array push is not: seeding the
 * same document twice leaves every id in the order array twice, which renders
 * as duplicated nodes, duplicated requirements, and duplicated milestones.
 *
 * That was theoretical while seeding only ever ran against a brand-new Y.Doc.
 * It stops being theoretical the moment `y-indexeddb` restores a document
 * before the seed decision is made, which is precisely the ordering WS2-R2
 * requires. Two defences, because the cost of getting this wrong is silent
 * corruption of the user's document:
 *
 *  1. `isYjsDocEmpty` lets callers avoid seeding a populated document at all.
 *  2. The seeds themselves skip ids that are already present, so a caller that
 *     forgets defence 1 still cannot corrupt anything.
 */
import * as Y from 'yjs';

/** Root collections that indicate a document already holds content. Keep in
 * step with the seedYjs*Doc functions - a collection seeded but not listed
 * here would let an emptiness check pass against a populated document. */
const CONTENT_COLLECTIONS = [
  'nodeOrder',
  'edgeOrder',
  'itemTypeOrder',
  'categoryOrder',
  'itemOrder',
  'piOrder',
  'milestoneOrder',
  'memberOrder',
] as const;

/**
 * Whether the document holds no seeded content.
 *
 * Deliberately checks the ordering arrays rather than the maps: an order array
 * is only ever written alongside its map entry, and reading arrays avoids
 * instantiating every nested Y.Map just to count them.
 */
export function isYjsDocEmpty(doc: Y.Doc): boolean {
  return CONTENT_COLLECTIONS.every((name) => doc.getArray<string>(name).length === 0);
}

/** Ids already present in an ordering array, as a set for O(1) lookup during
 * a seed pass rather than a scan per id. */
export function orderIdSet(order: Y.Array<string>): Set<string> {
  return new Set(order.toArray());
}

/**
 * Appends `id` unless it is already present, keeping `seen` in step.
 *
 * Returns whether the id was appended, so callers can skip building the
 * associated Y.Map entirely rather than constructing one and discarding it.
 */
export function pushIfAbsent(order: Y.Array<string>, seen: Set<string>, id: string): boolean {
  if (seen.has(id)) return false;
  order.push([id]);
  seen.add(id);
  return true;
}
