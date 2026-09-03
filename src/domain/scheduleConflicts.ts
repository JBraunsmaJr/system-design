import type { RequirementItem, RequirementRelationship } from "./requirementsTypes";

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
 * Deliberately scoped to the BUILT-IN "blocks" relationship type only
 * (id === "blocks"), not any custom type a user might define - unlike
 * item types, RelationshipType has no "this represents a blocking
 * dependency" flag today, and the built-in type's id is guaranteed stable
 * since built-in types can't be renamed or deleted. Custom types (e.g. a
 * user-defined "Depends on") aren't included in conflict detection yet.
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
  sprintRangesByItemId: Map<string, { startDate: string; endDate: string }>
): ScheduleConflict[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const conflicts: ScheduleConflict[] = [];

  for (const rel of relationships) {
    if (rel.typeId !== "blocks") continue;
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
