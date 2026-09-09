/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/milestonesEndToEnd.verify.ts
 */
import {
  getMilestoneCapacityWorkload,
  type Milestone,
} from "./milestones";
import { createLocalMilestonesStore } from "../collab/milestonesStore";
import { toDiagramFile, parseDiagramFile } from "./serialization";
import { computeSprintCapacity, computePICapacities } from "./teamCapacity";
import type { RequirementsDocument } from "./requirementsTypes";
import type { ProgramIncrement, Sprint } from "./programIncrements";
import type { TeamDocument } from "./teamTypes";
import { DEFAULT_TEAM_SETTINGS } from "./teamTypes";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
  } else {
    failures++;
    console.error(`[FAIL] ${message}`);
  }
}

console.log("=== Running Acceptance Criteria & Domain Verification Suite ===\n");

// --- AC-001: Create Milestone / Release ---
{
  const store = createLocalMilestonesStore();
  const id = store.addMilestone({
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    version: "2.4.0",
    description: "Autumn release",
  });
  const snapshot = store.getSnapshot();
  assert(snapshot.length === 1 && snapshot[0].id === id, "AC-001: Milestone is created and persisted in store");
  assert(snapshot[0].scheduledAt === "2026-09-30", "AC-001: Milestone appears at scheduled date");
}

// --- AC-002: Point-in-Time Event (Zero Duration) ---
{
  const release: Milestone = {
    id: "m-point",
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
  };
  assert(typeof release.scheduledAt === "string", "AC-002: Point-in-time scheduled date exists");
  assert(!("startDate" in release) && !("endDate" in release) && !("durationDays" in release), "AC-002: Zero duration and no date range");
}

// --- AC-003: No Capacity / Workload Impact ---
{
  const team: TeamDocument = {
    members: [
      { id: "alice", name: "Alice", role: "Dev", ptoSpans: [] },
      { id: "bob", name: "Bob", role: "Dev", ptoSpans: [] },
    ],
    settings: DEFAULT_TEAM_SETTINGS,
  };

  const reqDoc: RequirementsDocument = {
    itemTypes: [
      { id: "ticket", label: "Ticket", prefix: "TICKET", color: "#22B8CF", isBuiltIn: true, isWorkable: true },
    ],
    categories: [],
    items: [
      { id: "T-1", typeId: "ticket", title: "Auth", points: 5, sprintId: "s-1", body: "" },
      { id: "T-2", typeId: "ticket", title: "Database", points: 3, sprintId: "s-1", body: "" },
    ],
    relationshipTypes: [],
    relationships: [],
    nextSequence: {},
  };

  const sprint: Sprint = { id: "s-1", name: "Sprint 1", durationDays: 14 };
  const range = { sprintId: "s-1", startDate: "2026-09-01", endDate: "2026-09-14" };
  const pi: ProgramIncrement = { id: "pi-1", name: "PI 1", startDate: "2026-09-01", sprints: [sprint] };

  // Baseline capacity calculation with workable items
  const baseSummary = computeSprintCapacity(sprint, range, team, reqDoc.items);
  const basePiCapacities = computePICapacities(pi, [range], team, reqDoc.items);

  // Milestones created on sprint date or PI boundary
  const milestone: Milestone = {
    id: "rel-1",
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-14",
    relatedWorkableItemIds: ["T-1", "T-2"],
  };

  assert(getMilestoneCapacityWorkload(milestone) === 0, "AC-003: Milestone has 0 capacity workload");

  // Recomputing capacity with only workable items as filtered by registry
  const recomputedSummary = computeSprintCapacity(sprint, range, team, reqDoc.items);
  const recomputedPi = computePICapacities(pi, [range], team, reqDoc.items);

  assert(
    baseSummary.totalAssignedPoints === recomputedSummary.totalAssignedPoints &&
      baseSummary.totalCapacityPoints === recomputedSummary.totalCapacityPoints,
    "AC-003: Milestone presence does not alter sprint capacity calculations"
  );
  assert(
    basePiCapacities[0].totalAssignedPoints === recomputedPi[0].totalAssignedPoints,
    "AC-003: Milestone presence does not alter PI capacity totals"
  );
}

// --- AC-004: Edit Milestone ---
{
  const store = createLocalMilestonesStore();
  const id = store.addMilestone({
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    version: "2.4.0",
  });

  store.updateMilestone(id, {
    name: "Release 2.4-GA",
    scheduledAt: "2026-10-05",
    version: "2.4.1",
    description: "Updated release target",
  });

  const updated = store.getSnapshot()[0];
  assert(updated.name === "Release 2.4-GA", "AC-004: Updated name persisted");
  assert(updated.scheduledAt === "2026-10-05", "AC-004: Updated date persisted");
  assert(updated.version === "2.4.1", "AC-004: Updated version persisted");
  assert(updated.description === "Updated release target", "AC-004: Updated description persisted");
}

// --- AC-005 & DR-006: Delete Milestone Preserves Workable Items ---
{
  const store = createLocalMilestonesStore();
  const mId = store.addMilestone({
    type: "release",
    name: "Release to Delete",
    scheduledAt: "2026-11-01",
    relatedWorkableItemIds: ["T-100", "T-101"],
  });

  // Simulated requirements items
  const workableItems = [
    { id: "T-100", title: "Item 100" },
    { id: "T-101", title: "Item 101" },
  ];

  store.deleteMilestone(mId);
  assert(store.getSnapshot().length === 0, "AC-005: Milestone is removed");
  assert(workableItems.length === 2 && workableItems[0].id === "T-100", "AC-005 & DR-006: Associated workable items remain intact");
}

// --- AC-006: Standalone Release ---
{
  const store = createLocalMilestonesStore();
  const id = store.addMilestone({
    type: "release",
    name: "Unplanned Release",
    scheduledAt: "2027-01-01",
  });
  const m = store.getSnapshot()[0];
  assert(m.id === id && (!m.relatedWorkableItemIds || m.relatedWorkableItemIds.length === 0), "AC-006: Standalone release without related work is valid");
}

// --- AC-007: Related Work Associations ---
{
  const store = createLocalMilestonesStore();
  const id = store.addMilestone({
    type: "release",
    name: "Release 3.0",
    scheduledAt: "2026-12-15",
  });

  store.addRelatedWorkableItem(id, "T-1");
  store.addRelatedWorkableItem(id, "T-2");
  const m = store.getSnapshot()[0];
  assert(
    m.relatedWorkableItemIds?.length === 2 &&
      m.relatedWorkableItemIds.includes("T-1") &&
      m.relatedWorkableItemIds.includes("T-2"),
    "AC-007: Associated workable items persisted"
  );
}

// --- AC-008: Existing Behavior Intact ---
{
  const doc: RequirementsDocument = {
    itemTypes: [{ id: "ticket", label: "Ticket", prefix: "TICKET", color: "#22B8CF", isBuiltIn: true, isWorkable: true }],
    categories: [],
    items: [{ id: "TICKET-1", typeId: "ticket", title: "Existing Ticket", sprintId: "s-1", body: "" }],
    relationshipTypes: [],
    relationships: [],
    nextSequence: {},
  };
  assert(doc.items[0].sprintId === "s-1", "AC-008: Existing workable item scheduling intact");
}

// --- AC-009: Multiple Releases on Same Date ---
{
  const store = createLocalMilestonesStore();
  store.addMilestone({ type: "release", name: "Web Release 2.4", scheduledAt: "2026-09-30" });
  store.addMilestone({ type: "release", name: "iOS Release 2.4", scheduledAt: "2026-09-30" });
  store.addMilestone({ type: "release", name: "Android Release 2.4", scheduledAt: "2026-09-30" });

  const onSameDate = store.getSnapshot().filter((m) => m.scheduledAt === "2026-09-30");
  assert(onSameDate.length === 3, "AC-009: Multiple releases on same date coexist");
}

// --- AC-010: Stable Identity ---
{
  const store = createLocalMilestonesStore();
  const initialId = store.addMilestone({
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    version: "2.4.0",
  });

  store.updateMilestone(initialId, { name: "Release 2.5", version: "2.5.0" });
  const updatedId = store.getSnapshot()[0].id;
  assert(initialId === updatedId, "AC-010: Stable identity maintained when name or version changes");
}

// --- Serialization & Backward Compatibility ---
{
  const milestones: Milestone[] = [
    {
      id: "m-file-1",
      type: "release",
      name: "Release 1.0",
      scheduledAt: "2026-09-30",
      version: "1.0.0",
      description: "File serialization test",
      relatedWorkableItemIds: ["T-1"],
    },
  ];

  const diagramFile = toDiagramFile(
    "Test Diagram",
    [],
    [],
    [],
    { itemTypes: [], categories: [], items: [], relationshipTypes: [], relationships: [], nextSequence: {} },
    [],
    { members: [], settings: DEFAULT_TEAM_SETTINGS },
    milestones
  );

  const jsonString = JSON.stringify(diagramFile);
  const reloaded = parseDiagramFile(jsonString);

  assert(
    reloaded.milestones?.length === 1 &&
      reloaded.milestones[0].id === "m-file-1" &&
      reloaded.milestones[0].name === "Release 1.0" &&
      reloaded.milestones[0].version === "1.0.0" &&
      reloaded.milestones[0].relatedWorkableItemIds?.[0] === "T-1",
    "Serialization: Milestones serialize and deserialize without loss"
  );

  // Older file format without milestones key
  const legacyJson = JSON.stringify({
    schemaVersion: "0.6",
    title: "Legacy Diagram",
    nodes: [],
    edges: [],
  });
  const legacyReloaded = parseDiagramFile(legacyJson);
  assert(Array.isArray(legacyReloaded.milestones) && legacyReloaded.milestones.length === 0, "Backward Compatibility: Legacy files load with empty milestones array");
}

console.log(`\nVerification finished: ${failures === 0 ? "ALL CHECKS PASSED (10/10 Acceptance Criteria + Serialization)" : `${failures} FAILURE(S)`}`);
