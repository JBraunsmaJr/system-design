import type { RequirementItem, RequirementRelationship, RelationshipType } from "./requirementsTypes";

export interface ScheduleConflict {
  id: string;
  item: RequirementItem;
  blocker: RequirementItem;
  relationshipId: string;
  itemRange: { startDate: string; endDate: string };
  /** Null when the blocker has no sprint assignment at all - a different
   * (arguably more urgent) case than a blocker whose sprint just doesn't
   * finish in time, since there's no schedule to point at yet. */
  blockerRange: { startDate: string; endDate: string } | null;
}

/**
 * Finds every case where a scheduled item is blocked by another item that
 * won't be finished in time - either because the blocker has no sprint
 * assignment at all, or because the blocker's sprint doesn't end before
 * the blocked item's sprint begins (including the same sprint, since
 * there's no guarantee of within-sprint ordering, and overlapping sprints
 * across different program increments).
 *
 * Considers every relationship whose TYPE is marked blocking (see
 * RelationshipType.isBlocking), not just the literal built-in "Blocks"
 * id - a custom type a user marks blocking (e.g. "Depends on") is now
 * honored here too, matching how cycle prevention already treats any
 * blocking-flagged type the same way. This used to hardcode the "blocks"
 * id specifically, from before isBlocking existed as a general flag;
 * fixed to stay consistent with the rest of the app's dependency logic.
 *
 * Only direct (one-hop) blocking relationships are considered - if a
 * conflict's blocker is itself blocked by something else, that's a
 * separate conflict entry for the blocker, not chased transitively here.
 *
 * `sprintRangesByItemId` should map an item's id to its own sprint's
 * computed date range - only items with sprintId set and a resolvable
 * sprint will have an entry; everything else naturally falls into the
 * "unscheduled" handling below without needing a separate check.
 */
export function findScheduleConflicts(
  items: RequirementItem[],
  relationships: RequirementRelationship[],
  relationshipTypes: RelationshipType[],
  sprintRangesByItemId: Map<string, { startDate: string; endDate: string }>
): ScheduleConflict[] {
  const blockingTypeIds = new Set(relationshipTypes.filter((t) => t.isBlocking).map((t) => t.id));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const conflicts: ScheduleConflict[] = [];

  for (const rel of relationships) {
    if (!blockingTypeIds.has(rel.typeId)) continue;
    const blockerId = rel.fromItemId;
    const itemId = rel.toItemId;
    if (blockerId === itemId) continue;

    const item = itemById.get(itemId);
    const blocker = itemById.get(blockerId);
    if (!item || !blocker) continue;

    const itemRange = sprintRangesByItemId.get(itemId);
    if (!itemRange) continue;

    const blockerRange = sprintRangesByItemId.get(blockerId) ?? null;
    const isConflict = !blockerRange || blockerRange.endDate >= itemRange.startDate;
    if (!isConflict) continue;

    conflicts.push({
      id: rel.id,
      item,
      blocker,
      relationshipId: rel.id,
      itemRange,
      blockerRange,
    });
  }

  return conflicts;
}

export interface HypotheticalScheduleConflict {
  blocker: RequirementItem;
  /** Null when the blocker has no sprint assignment at all - same
   * distinction as ScheduleConflict.blockerRange. */
  blockerRange: { startDate: string; endDate: string } | null;
}

/**
 * Checks whether assigning `itemId` to a sprint with `targetRange` would
 * create a scheduling conflict against its blockers - the same rule
 * findScheduleConflicts uses for items already scheduled, but evaluated
 * hypothetically BEFORE committing a new assignment, so a caller can
 * reject the assignment outright rather than only detecting the problem
 * after the fact. Returns the first conflicting blocker found (an item
 * can have several; this is enough to explain why the assignment can't
 * proceed and point at what needs to move first), or null if the
 * assignment would be conflict-free.
 *
 * Only checks relationships where `itemId` is the BLOCKED side
 * (toItemId) - an item it blocks, rather than one that blocks it, has no
 * bearing on whether this item itself can be scheduled here.
 */
export function checkScheduleConflict(
  itemId: string,
  targetRange: { startDate: string; endDate: string },
  items: RequirementItem[],
  relationships: RequirementRelationship[],
  relationshipTypes: RelationshipType[],
  sprintRangesByItemId: Map<string, { startDate: string; endDate: string }>
): HypotheticalScheduleConflict | null {
  const blockingTypeIds = new Set(relationshipTypes.filter((t) => t.isBlocking).map((t) => t.id));
  const itemById = new Map(items.map((i) => [i.id, i]));

  for (const rel of relationships) {
    if (!blockingTypeIds.has(rel.typeId)) continue;
    if (rel.toItemId !== itemId) continue;
    const blockerId = rel.fromItemId;
    if (blockerId === itemId) continue;
    const blocker = itemById.get(blockerId);
    if (!blocker) continue;

    const blockerRange = sprintRangesByItemId.get(blockerId) ?? null;
    const isConflict = !blockerRange || blockerRange.endDate >= targetRange.startDate;
    if (isConflict) {
      return { blocker, blockerRange };
    }
  }
  return null;
}
