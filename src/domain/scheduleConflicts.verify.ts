/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/scheduleConflicts.verify.ts
 */
import { findScheduleConflicts, checkScheduleConflict, findBlockingItemIds } from "./scheduleConflicts";
import type { RequirementItem, RequirementRelationship, RelationshipType, RequirementItemType } from "./requirementsTypes";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const itemTypes: RequirementItemType[] = [
  { id: "ticket", label: "Ticket", prefix: "TICKET", color: "#22B8CF", isBuiltIn: true, isWorkable: true },
  { id: "requirement", label: "Requirement", prefix: "REQ", color: "#5b7cfa", isBuiltIn: true, isWorkable: false },
];

const relationshipTypes: RelationshipType[] = [
  { id: "blocks", label: "Blocks", inverseLabel: "Is blocked by", color: "#F0578C", isBuiltIn: true, isBlocking: true },
  { id: "relates", label: "Relates to", inverseLabel: "Relates to", color: "#98a2b3", isBuiltIn: true, isBlocking: false },
];

function item(id: string, typeId: string, sprintId?: string): RequirementItem {
  return { id, typeId, title: id, body: "", status: typeId === "ticket" ? "todo" : undefined, sprintId } as RequirementItem;
}
function rel(id: string, from: string, to: string, typeId = "blocks"): RequirementRelationship {
  return { id, typeId, fromItemId: from, toItemId: to };
}

const SPRINT_1 = { startDate: "2026-01-01", endDate: "2026-01-14" };
const SPRINT_2 = { startDate: "2026-01-15", endDate: "2026-01-28" };

// === Part 1: a NON-WORKABLE blocker never blocks scheduling ===
// The reported bug. A Requirement can't be assigned to a sprint and
// never reaches "done" (defaultStatusForType gives it no status at all),
// so treating "the blocker isn't scheduled yet" as a hard block locked
// the ticket out of every sprint permanently, with no action available
// that could ever clear it.
{
  const items = [item("TICKET-1", "ticket"), item("REQ-1", "requirement")];
  const relationships = [rel("r1", "REQ-1", "TICKET-1")];

  const conflict = checkScheduleConflict(
    "TICKET-1",
    "sprint-1",
    SPRINT_1,
    items,
    relationships,
    relationshipTypes,
    itemTypes,
    new Map()
  );

  assert(conflict === null, "a ticket blocked by a Requirement can be assigned to a sprint - the non-workable blocker is not a scheduling conflict");
}

// === Part 2: a WORKABLE unscheduled blocker still blocks ===
// The guard must not have thrown away the real rule along with the bug.
{
  const items = [item("TICKET-1", "ticket"), item("TICKET-2", "ticket")];
  const relationships = [rel("r1", "TICKET-2", "TICKET-1")];

  const conflict = checkScheduleConflict(
    "TICKET-1",
    "sprint-1",
    SPRINT_1,
    items,
    relationships,
    relationshipTypes,
    itemTypes,
    new Map()
  );

  assert(conflict?.severity === "blocked", "a ticket blocked by another unscheduled TICKET is still blocked - the fix narrows the rule, it doesn't remove it");
  assert(conflict?.blocker.id === "TICKET-2", "and names the actual blocker");
}

// === Part 3: mixed blockers - the workable one still wins ===
// A non-workable blocker must not mask a genuine one, and must not be
// reported in its place.
{
  const items = [item("TICKET-1", "ticket"), item("TICKET-2", "ticket"), item("REQ-1", "requirement")];
  const relationships = [rel("r1", "REQ-1", "TICKET-1"), rel("r2", "TICKET-2", "TICKET-1")];

  const conflict = checkScheduleConflict(
    "TICKET-1",
    "sprint-1",
    SPRINT_1,
    items,
    relationships,
    relationshipTypes,
    itemTypes,
    new Map()
  );

  assert(conflict?.severity === "blocked" && conflict.blocker.id === "TICKET-2", "with both a Requirement and an unscheduled Ticket blocking it, the real blocker is still reported and the Requirement is ignored");
}

// === Part 4: same-sprint workable blocker is still only a "risk" ===
{
  const items = [item("TICKET-1", "ticket", "sprint-1"), item("TICKET-2", "ticket", "sprint-1")];
  const relationships = [rel("r1", "TICKET-2", "TICKET-1")];
  const ranges = new Map([["TICKET-2", SPRINT_1]]);

  const conflict = checkScheduleConflict("TICKET-1", "sprint-1", SPRINT_1, items, relationships, relationshipTypes, itemTypes, ranges);

  assert(conflict?.severity === "risk", "a blocker in the SAME sprint is still a risk rather than a hard block - unchanged by this fix");
}

// === Part 5: findScheduleConflicts agrees with checkScheduleConflict ===
// The board and the Gantt use different entry points for the same rule;
// they have to reach the same verdict or an item is rejected on drop and
// then flagged as fine once placed (or the reverse).
{
  const items = [item("TICKET-1", "ticket", "sprint-1"), item("REQ-1", "requirement")];
  const relationships = [rel("r1", "REQ-1", "TICKET-1")];
  const ranges = new Map([["TICKET-1", SPRINT_1]]);

  const conflicts = findScheduleConflicts(items, relationships, relationshipTypes, itemTypes, ranges);

  assert(conflicts.length === 0, "an already-scheduled ticket is not flagged as conflicted just because a Requirement blocks it");
}

// === Part 6: a real conflict is still found by findScheduleConflicts ===
{
  const items = [item("TICKET-1", "ticket", "sprint-1"), item("TICKET-2", "ticket", "sprint-2")];
  const relationships = [rel("r1", "TICKET-2", "TICKET-1")];
  const ranges = new Map([
    ["TICKET-1", SPRINT_1],
    ["TICKET-2", SPRINT_2],
  ]);

  const conflicts = findScheduleConflicts(items, relationships, relationshipTypes, itemTypes, ranges);

  assert(conflicts.length === 1 && conflicts[0].severity === "blocked", "a blocker scheduled AFTER the item it blocks is still a genuine conflict");
}

// === Part 7: findBlockingItemIds skips non-workable blockers ===
// Drives the drag-time "these must come first" highlight. An item that
// can never be scheduled can never come first.
{
  const items = [item("TICKET-1", "ticket"), item("TICKET-2", "ticket"), item("REQ-1", "requirement")];
  const relationships = [rel("r1", "REQ-1", "TICKET-1"), rel("r2", "TICKET-2", "TICKET-1")];

  const blockers = findBlockingItemIds("TICKET-1", relationships, relationshipTypes, itemTypes, items);

  assert(!blockers.has("REQ-1"), "a Requirement is not highlighted as something that must be scheduled first");
  assert(blockers.has("TICKET-2"), "a workable blocker still is");
}

// === Part 8: traversal does not pass THROUGH a non-workable item ===
// TICKET-3 blocks REQ-1 blocks TICKET-1. Chasing through REQ-1 would
// pull in documentation lineage as if it were schedule ordering.
{
  const items = [item("TICKET-1", "ticket"), item("TICKET-3", "ticket"), item("REQ-1", "requirement")];
  const relationships = [rel("r1", "REQ-1", "TICKET-1"), rel("r2", "TICKET-3", "REQ-1")];

  const blockers = findBlockingItemIds("TICKET-1", relationships, relationshipTypes, itemTypes, items);

  assert(blockers.size === 0, "traversal stops at the non-workable item rather than continuing to whatever blocks IT");
}

// === Part 9: transitive workable chains still traverse fully ===
{
  const items = [item("TICKET-1", "ticket"), item("TICKET-2", "ticket"), item("TICKET-3", "ticket")];
  const relationships = [rel("r1", "TICKET-2", "TICKET-1"), rel("r2", "TICKET-3", "TICKET-2")];

  const blockers = findBlockingItemIds("TICKET-1", relationships, relationshipTypes, itemTypes, items);

  assert(blockers.has("TICKET-2") && blockers.has("TICKET-3"), "an all-workable chain is still followed transitively");
}

// === Part 10: non-blocking relationship types are still irrelevant ===
{
  const items = [item("TICKET-1", "ticket"), item("TICKET-2", "ticket")];
  const relationships = [rel("r1", "TICKET-2", "TICKET-1", "relates")];

  const conflict = checkScheduleConflict("TICKET-1", "sprint-1", SPRINT_1, items, relationships, relationshipTypes, itemTypes, new Map());

  assert(conflict === null, "a non-blocking relationship type never produces a conflict, workable or not");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
