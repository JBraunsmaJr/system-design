import type { RequirementItem, RequirementRelationship, RelationshipType } from "./requirementsTypes";

/**
 * "blocked" - the blocker's own timing genuinely can't be sequenced ahead
 * of this item: it isn't scheduled at all, or it's scheduled in a
 * DIFFERENT sprint that doesn't finish before this item's sprint starts.
 * There's no shared window in which "do the blocker first" is something
 * the team can just decide to do - the schedules themselves conflict.
 *
 * "risk" - the blocker is scheduled in the exact SAME sprint as this
 * item. Both could genuinely be completed within that one sprint (e.g. a
 * 3-point item blocking a 5-point item, both well within a team's
 * capacity) - this isn't a scheduling contradiction, it's an ordering
 * dependency the team needs to actually respect *within* the sprint, so
 * it's surfaced rather than hidden, but it doesn't prevent the
 * assignment the way "blocked" does.
 */
export type ScheduleConflictSeverity = "blocked" | "risk";

export interface ScheduleConflict {
  id: string;
  item: RequirementItem;
  blocker: RequirementItem;
  relationshipId: string;
  itemRange: { startDate: string; endDate: string };
  /** Null when the blocker has no sprint assignment at all - always
   * "blocked" severity in that case, since there's no schedule to point
   * at yet, let alone confirm it's the same sprint. */
  blockerRange: { startDate: string; endDate: string } | null;
  severity: ScheduleConflictSeverity;
}

/**
 * Finds every case where a scheduled item is blocked by another item that
 * won't be finished in time - either because the blocker has no sprint
 * assignment at all, or because the blocker's sprint doesn't end before
 * the blocked item's sprint begins. A blocker in the exact SAME sprint is
 * reported too, but as "risk" rather than "blocked" - see
 * ScheduleConflictSeverity's own doc comment for why that distinction
 * matters. Same-sprint-ness is checked via the items' own sprintId
 * fields directly (not by comparing date ranges), since two different
 * sprints could theoretically share identical dates without being the
 * same sprint.
 *
 * Considers every relationship whose TYPE is marked blocking (see
 * RelationshipType.isBlocking), not just the literal built-in "Blocks"
 * id - a custom type a user marks blocking (e.g. "Depends on") is
 * honored here too, matching how cycle prevention already treats any
 * blocking-flagged type the same way.
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

    let severity: ScheduleConflictSeverity;
    if (!blockerRange) {
      severity = "blocked";
    } else if (item.sprintId && item.sprintId === blocker.sprintId) {
      severity = "risk";
    } else if (blockerRange.endDate >= itemRange.startDate) {
      severity = "blocked";
    } else {
      continue;
    }

    conflicts.push({
      id: rel.id,
      item,
      blocker,
      relationshipId: rel.id,
      itemRange,
      blockerRange,
      severity,
    });
  }

  return conflicts;
}

export interface HypotheticalScheduleConflict {
  blocker: RequirementItem;
  /** Null when the blocker has no sprint assignment at all - same
   * distinction as ScheduleConflict.blockerRange. */
  blockerRange: { startDate: string; endDate: string } | null;
  severity: ScheduleConflictSeverity;
}

/**
 * Checks whether assigning `itemId` to `targetSprintId` (with
 * `targetRange`) would create a scheduling conflict against its
 * blockers - the same rule findScheduleConflicts uses for items already
 * scheduled, evaluated hypothetically BEFORE committing a new
 * assignment.
 *
 * Returns the MOST SEVERE conflict found, not just the first one
 * encountered - a "blocked" result is returned immediately (nothing can
 * be more severe), while a "risk" result is remembered and only returned
 * if no "blocked" ever turns up among the item's other blockers. This
 * matters because a caller showing a live preview (e.g. while dragging,
 * before a drop even happens) wants to know about a same-sprint "risk"
 * too, not just hard blocks - but a genuine "blocked" conflict must never
 * be silently masked just because a "risk" blocker happened to be listed
 * first in the relationships array. Verified this holds regardless of
 * relationship iteration order before relying on it.
 *
 * Callers that need to REJECT an assignment (rather than just preview
 * it) should only reject when the returned conflict's severity is
 * "blocked" - a "risk" is meant to be allowed through; see
 * ScheduleConflictSeverity's own doc comment for why.
 *
 * Only checks relationships where `itemId` is the BLOCKED side
 * (toItemId) - an item it blocks, rather than one that blocks it, has no
 * bearing on whether this item itself can be scheduled here.
 */
export function checkScheduleConflict(
  itemId: string,
  targetSprintId: string,
  targetRange: { startDate: string; endDate: string },
  items: RequirementItem[],
  relationships: RequirementRelationship[],
  relationshipTypes: RelationshipType[],
  sprintRangesByItemId: Map<string, { startDate: string; endDate: string }>
): HypotheticalScheduleConflict | null {
  const blockingTypeIds = new Set(relationshipTypes.filter((t) => t.isBlocking).map((t) => t.id));
  const itemById = new Map(items.map((i) => [i.id, i]));

  let bestRiskSoFar: HypotheticalScheduleConflict | null = null;

  for (const rel of relationships) {
    if (!blockingTypeIds.has(rel.typeId)) continue;
    if (rel.toItemId !== itemId) continue;
    const blockerId = rel.fromItemId;
    if (blockerId === itemId) continue;
    const blocker = itemById.get(blockerId);
    if (!blocker) continue;

    const blockerRange = sprintRangesByItemId.get(blockerId) ?? null;

    let severity: ScheduleConflictSeverity;
    if (!blockerRange) {
      severity = "blocked";
    } else if (blocker.sprintId === targetSprintId) {
      severity = "risk";
    } else if (blockerRange.endDate >= targetRange.startDate) {
      severity = "blocked";
    } else {
      continue;
    }

    if (severity === "blocked") {
      return { blocker, blockerRange, severity };
    }
    if (!bestRiskSoFar) {
      bestRiskSoFar = { blocker, blockerRange, severity };
    }
  }
  return bestRiskSoFar;
}

/**
 * Finds all item IDs that directly or transitively block the given item.
 * Follows relationships where the relationship type is marked blocking
 * (isBlocking: true) from toItemId to fromItemId.
 */
export function findBlockingItemIds(
  itemId: string,
  relationships: RequirementRelationship[],
  relationshipTypes: RelationshipType[]
): Set<string> {
  const blockingTypeIds = new Set(relationshipTypes.filter((t) => t.isBlocking).map((t) => t.id));
  const blockers = new Set<string>();
  const queue = [itemId];
  const visited = new Set<string>([itemId]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const rel of relationships) {
      if (!blockingTypeIds.has(rel.typeId)) continue;
      if (rel.toItemId === currentId) {
        const blockerId = rel.fromItemId;
        if (!visited.has(blockerId)) {
          visited.add(blockerId);
          blockers.add(blockerId);
          queue.push(blockerId);
        }
      }
    }
  }

  return blockers;
}
