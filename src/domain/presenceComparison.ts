/**
 * The subset of a peer that a presence badge actually draws. Declared
 * structurally rather than importing PresenceInfo from src/collab so
 * this stays a plain domain module with no dependency on the session
 * layer - PresenceInfo satisfies it by shape.
 */
export interface PeerBadge {
  clientId: number;
  name: string;
  color: string;
}

/**
 * Whether two lists of peers would draw the same presence badges.
 *
 * Exists because the obvious comparison - array identity - is wrong in
 * both directions for this data.
 *
 * Too strict: the arrays are rebuilt by a `.filter()` on every parent
 * render, so identity always differs and a memo comparing it would
 * re-render every card on every render of the list.
 *
 * Too loose in the other sense: comparing the peer OBJECTS by identity
 * doesn't help either, because presence updates rebuild them wholesale,
 * and presence updates include cursor movement. Every peer mouse move
 * would re-render every card in the list, for badges whose appearance
 * cannot change from a cursor moving.
 *
 * So this compares exactly the three fields a badge renders: clientId
 * (its React key), color (the dot) and name (the initial, and the
 * hover title). If a badge ever starts rendering another field, it has
 * to be added here too, or the badge will render stale - that coupling
 * is the cost of not re-rendering on every cursor tick.
 *
 * Order-sensitive on purpose. Peers arrive in awareness-map order,
 * which can reorder without the set changing; that yields a redundant
 * re-render rather than a missed one, which is the safe direction, and
 * it avoids sorting on every comparison.
 */
export function peerBadgesAreEqual(prev: PeerBadge[] | undefined, next: PeerBadge[] | undefined): boolean {
  if (prev === next) return true;
  const a = prev ?? [];
  const b = next ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].clientId !== b[i].clientId || a[i].name !== b[i].name || a[i].color !== b[i].color) return false;
  }
  return true;
}
