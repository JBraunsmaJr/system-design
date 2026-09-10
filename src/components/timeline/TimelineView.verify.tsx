/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/timeline/TimelineView.verify.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TimelineView } from "./TimelineView";
import type { ProgramIncrement } from "../../domain/programIncrements";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from "../../domain/requirementsRegistry";
import { findBlockingItemIds } from "../../domain/scheduleConflicts";
import { createLocalProgramIncrementsStore } from "../../collab/programIncrementsStore";
import { createLocalRequirementsStore } from "../../collab/requirementsStore";
import { createLocalMilestonesStore } from "../../collab/milestonesStore";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
  } else {
    failures++;
    console.error(`[FAIL] ${message}`);
  }
}

console.log("=== Running TimelineView Verification Suite ===\n");

const mockPIs: ProgramIncrement[] = [
  {
    id: "pi-1",
    name: "PI 1",
    startDate: "2026-10-01",
    sprints: [
      { id: "sprint-1", name: "Sprint 1", durationDays: 14 },
      { id: "sprint-2", name: "Sprint 2", durationDays: 14 },
    ],
  },
];

const mockDoc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  items: [
    { id: "TICKET-1", typeId: "ticket", title: "API Gateway", body: "", sprintId: "sprint-1" },
    { id: "TICKET-2", typeId: "ticket", title: "User Auth", body: "" }, // in backlog, blocked by TICKET-1
  ],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [
    { id: "rel-1", typeId: "blocks", fromItemId: "TICKET-1", toItemId: "TICKET-2" },
  ],
  nextSequence: {},
};

// --- Test 1: findBlockingItemIds detects workable blockers when an item is dragged ---
{
  const blockersWhenDraggingTicket2 = findBlockingItemIds(
    "TICKET-2",
    mockDoc.relationships,
    mockDoc.relationshipTypes,
    mockDoc.itemTypes,
    mockDoc.items
  );

  assert(blockersWhenDraggingTicket2.has("TICKET-1"), "TICKET-1 is identified as a blocker when TICKET-2 is dragged");
  assert(!blockersWhenDraggingTicket2.has("TICKET-2"), "TICKET-2 is not a blocker of itself");
}

// --- Test 2: In default state (no active drag), no blocker highlighting or blocker badge exists ---
{
  const piStore = createLocalProgramIncrementsStore(mockPIs);
  const reqStore = createLocalRequirementsStore(mockDoc);
  const msStore = createLocalMilestonesStore([]);
  const html = renderToStaticMarkup(
    React.createElement(TimelineView, {
      programIncrementsStore: piStore,
      requirementsStore: reqStore,
      milestonesStore: msStore,
      onNavigateToNode: () => {},
      onCreateLinkedNode: () => {},
      onNavigateToRequirement: () => {},
    })
  );

  assert(!html.includes("is-blocker-highlight"), "No cards have is-blocker-highlight when no item is dragged");
  assert(!html.includes("pi-board-item__blocker-badge"), "No cards have pi-board-item__blocker-badge when no item is dragged");
  assert(html.includes("TICKET-1"), "TICKET-1 card is rendered in sprint-1");
  assert(html.includes("TICKET-2"), "TICKET-2 card is rendered in backlog");
}

// --- Test 3: Clearing drag state removes all blocker highlighting and badges ---
{
  // When draggedItemId becomes null, findBlockingItemIds returns an empty set
  const blockersWhenNoneDragged = findBlockingItemIds(
    null as unknown as string,
    mockDoc.relationships,
    mockDoc.relationshipTypes,
    mockDoc.itemTypes,
    mockDoc.items
  );

  assert(blockersWhenNoneDragged.size === 0, "blockingItemIds set is empty when no item is dragged");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  throw new Error(`${failures} test(s) failed`);
}
