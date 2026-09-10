/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/timeline/GanttChart.verify.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GanttChart } from "./GanttChart";
import type { ProgramIncrement } from "../../domain/programIncrements";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from "../../domain/requirementsRegistry";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
  } else {
    failures++;
    console.error(`[FAIL] ${message}`);
  }
}

console.log("=== Running GanttChart Verification Suite ===\n");

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
    { id: "EPIC-1", typeId: "epic", title: "Authentication Epic", body: "" },
    { id: "EPIC-2", typeId: "epic", title: "Billing Epic", body: "" },
    { id: "TICKET-1", typeId: "ticket", title: "Login UI", body: "", sprintId: "sprint-1", points: 3 },
    { id: "TICKET-2", typeId: "ticket", title: "OAuth Backend", body: "", sprintId: "sprint-2", points: 5 },
    { id: "TICKET-3", typeId: "ticket", title: "Payment Gateway", body: "", sprintId: "sprint-1", points: 8 },
  ],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [
    { id: "r1", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-1" },
    { id: "r2", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-2" },
    { id: "r3", typeId: "parent-of", fromItemId: "EPIC-2", toItemId: "TICKET-3" },
  ],
  nextSequence: {},
};

// --- Test 1: GanttChart renders all items when filterEpicId="all" ---
{
  const html = renderToStaticMarkup(
    React.createElement(GanttChart, {
      programIncrements: mockPIs,
      requirements: mockDoc,
      filterEpicId: "all",
      onSelectItem: () => {},
    })
  );

  assert(html.includes("TICKET-1"), "TICKET-1 is present when filter is all");
  assert(html.includes("TICKET-2"), "TICKET-2 is present when filter is all");
  assert(html.includes("TICKET-3"), "TICKET-3 is present when filter is all");
  assert(html.includes("Authentication Epic"), "Authentication Epic track is rendered");
  assert(html.includes("Billing Epic"), "Billing Epic track is rendered");
}

// --- Test 2: GanttChart filters items and epics when filterEpicId is set to EPIC-1 ---
{
  const filteredChildIds = new Set(["TICKET-1", "TICKET-2"]);
  const html = renderToStaticMarkup(
    React.createElement(GanttChart, {
      programIncrements: mockPIs,
      requirements: mockDoc,
      filterEpicId: "EPIC-1",
      filteredChildItemIds: filteredChildIds,
      onSelectItem: () => {},
    })
  );

  assert(html.includes("TICKET-1"), "TICKET-1 (child of EPIC-1) is rendered");
  assert(html.includes("TICKET-2"), "TICKET-2 (child of EPIC-1) is rendered");
  assert(!html.includes("TICKET-3"), "TICKET-3 (child of EPIC-2) is filtered out");
  assert(html.includes("Authentication Epic"), "Authentication Epic is shown in epic track");
  assert(!html.includes("Billing Epic"), "Billing Epic is filtered out of epic track");
}

// --- Test 3: GanttChart filters items when filterEpicId is set to EPIC-2 ---
{
  const filteredChildIds = new Set(["TICKET-3"]);
  const html = renderToStaticMarkup(
    React.createElement(GanttChart, {
      programIncrements: mockPIs,
      requirements: mockDoc,
      filterEpicId: "EPIC-2",
      filteredChildItemIds: filteredChildIds,
      onSelectItem: () => {},
    })
  );

  assert(!html.includes("TICKET-1"), "TICKET-1 is filtered out");
  assert(!html.includes("TICKET-2"), "TICKET-2 is filtered out");
  assert(html.includes("TICKET-3"), "TICKET-3 (child of EPIC-2) is rendered");
  assert(!html.includes("Authentication Epic"), "Authentication Epic is filtered out");
  assert(html.includes("Billing Epic"), "Billing Epic is rendered in epic track");
}

// --- Test 4: GanttChart displays epic-specific empty message when an epic has no scheduled children ---
{
  const emptyEpicDoc: RequirementsDocument = {
    ...mockDoc,
    items: [
      ...mockDoc.items,
      { id: "EPIC-3", typeId: "epic", title: "Empty Epic", body: "" },
    ],
  };

  const html = renderToStaticMarkup(
    React.createElement(GanttChart, {
      programIncrements: mockPIs,
      requirements: emptyEpicDoc,
      filterEpicId: "EPIC-3",
      filteredChildItemIds: new Set<string>(),
      onSelectItem: () => {},
    })
  );

  assert(
    html.includes("No workable items matching the selected Epic are scheduled into a sprint yet."),
    "Shows epic-specific empty state message when epic has no scheduled items"
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  throw new Error(`${failures} test(s) failed`);
}
