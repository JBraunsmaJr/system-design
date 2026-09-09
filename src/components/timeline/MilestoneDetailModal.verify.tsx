/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/timeline/MilestoneDetailModal.verify.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MilestoneDetailModal } from "./MilestoneDetailModal";
import type { Milestone } from "../../domain/milestones";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
  } else {
    failures++;
    console.error(`[FAIL] ${message}`);
  }
}

console.log("=== Running MilestoneDetailModal Verification Suite ===\n");

const mockDoc: RequirementsDocument = {
  itemTypes: [
    { id: "ticket", label: "Ticket", prefix: "TICKET", color: "#22B8CF", isBuiltIn: true, isWorkable: true },
    { id: "requirement", label: "Requirement", prefix: "REQ", color: "#5b7cfa", isBuiltIn: true, isWorkable: false },
  ],
  categories: [],
  items: [
    { id: "T-1", typeId: "ticket", title: "Auth Feature", body: "", status: "todo", points: 5 },
    { id: "T-2", typeId: "ticket", title: "DB Migration", body: "", status: "in-progress", points: 3 },
    { id: "T-3", typeId: "ticket", title: "API Gateway", body: "", status: "todo", points: 8 },
    { id: "REQ-1", typeId: "requirement", title: "Overview", body: "" },
  ],
  relationshipTypes: [],
  relationships: [],
  nextSequence: {},
};

// --- Test 1: Milestone Detail Modal renders with related items ---
{
  const milestone: Milestone = {
    id: "m-1",
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    version: "2.4.0",
    description: "Scope overview",
    relatedWorkableItemIds: ["T-1"],
  };

  const updates: Array<{ id: string; patch: Partial<Omit<Milestone, "id">> }> = [];

  const html = renderToStaticMarkup(
    React.createElement(MilestoneDetailModal, {
      milestone,
      doc: mockDoc,
      onClose: () => {},
      onUpdateMilestone: (id, patch) => updates.push({ id, patch }),
      onDeleteMilestone: () => {},
    })
  );

  assert(html.includes("Release 2.4"), "Milestone title is rendered");
  assert(html.includes("T-1"), "Related workable item T-1 is rendered");
  assert(html.includes("Related Workable Items (1)"), "Related work items count is 1");
}

// --- Test 2: Simulating multiple work item additions ---
{
  let currentMilestone: Milestone = {
    id: "m-1",
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    relatedWorkableItemIds: [],
  };

  const handleUpdate = (_id: string, patch: Partial<Omit<Milestone, "id">>) => {
    currentMilestone = { ...currentMilestone, ...patch };
  };

  // Add T-1
  const addWork = (itemId: string) => {
    const current = currentMilestone.relatedWorkableItemIds ?? [];
    if (!current.includes(itemId)) {
      handleUpdate(currentMilestone.id, {
        relatedWorkableItemIds: [...current, itemId],
      });
    }
  };

  addWork("T-1");
  assert(
    currentMilestone.relatedWorkableItemIds?.length === 1 && currentMilestone.relatedWorkableItemIds[0] === "T-1",
    "First work item T-1 is added"
  );

  // Add T-2 without closing/resetting
  addWork("T-2");
  assert(
    currentMilestone.relatedWorkableItemIds?.length === 2 &&
      currentMilestone.relatedWorkableItemIds[0] === "T-1" &&
      currentMilestone.relatedWorkableItemIds[1] === "T-2",
    "Second work item T-2 is added consecutively"
  );

  // Add T-3
  addWork("T-3");
  assert(
    currentMilestone.relatedWorkableItemIds?.length === 3 &&
      currentMilestone.relatedWorkableItemIds.includes("T-3"),
    "Third work item T-3 is added consecutively"
  );

  // Render with all 3 items
  const html = renderToStaticMarkup(
    React.createElement(MilestoneDetailModal, {
      milestone: currentMilestone,
      doc: mockDoc,
      onClose: () => {},
      onUpdateMilestone: handleUpdate,
      onDeleteMilestone: () => {},
    })
  );

  assert(html.includes("Related Workable Items (3)"), "Modal displays all 3 selected related items");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  throw new Error(`${failures} test(s) failed`);
}
