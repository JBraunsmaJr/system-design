/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/epicScheduling.verify.ts
 */
import { computeEpicInferredSchedule } from "./epicScheduling";
import type { RequirementsDocument } from "./requirementsTypes";
import type { ProgramIncrement } from "./programIncrements";
import type { Milestone } from "./milestones";
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from "./requirementsRegistry";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const pis: ProgramIncrement[] = [
  {
    id: "pi-1",
    name: "PI 1",
    startDate: "2026-10-01",
    sprints: [
      { id: "sprint-1", name: "Sprint 1", durationDays: 14 }, // 2026-10-01 to 2026-10-14
      { id: "sprint-2", name: "Sprint 2", durationDays: 14 }, // 2026-10-15 to 2026-10-28
    ],
  },
  {
    id: "pi-2",
    name: "PI 2",
    startDate: "2026-10-29",
    sprints: [
      { id: "sprint-3", name: "Sprint 3", durationDays: 14 }, // 2026-10-29 to 2026-11-11
    ],
  },
];

const baseDoc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  items: [
    { id: "EPIC-1", typeId: "epic", title: "Authentication Epic", body: "" },
    { id: "TICKET-1", typeId: "ticket", title: "Login UI", body: "", sprintId: "sprint-1", points: 3, status: "done" },
    { id: "TICKET-2", typeId: "ticket", title: "SSO Integration", body: "", sprintId: "sprint-2", points: 5, status: "in-progress" },
    { id: "TICKET-3", typeId: "ticket", title: "Audit Logging", body: "", points: 2, status: "todo" }, // backlog
    { id: "EPIC-2", typeId: "epic", title: "Empty Epic", body: "" },
  ],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [
    { id: "rel-1", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-1" },
    { id: "rel-2", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-2" },
  ],
  nextSequence: {},
};

// --- Test 1: Full Schedule Inference (100% Scheduled Children - AC-003, DR-003) ---
{
  const schedule = computeEpicInferredSchedule("EPIC-1", baseDoc, pis);
  assert(schedule.startDate === "2026-10-01", "100% scheduled epic infers start date from Sprint 1");
  assert(schedule.endDate === "2026-10-28", "100% scheduled epic infers end date from Sprint 2");
  assert(schedule.isFullyScheduled === true, "100% scheduled epic has isFullyScheduled: true");
  assert(schedule.totalChildrenCount === 2, "total child workable count is 2");
  assert(schedule.scheduledChildrenCount === 2, "scheduled count is 2");
  assert(schedule.unscheduledChildrenCount === 0, "unscheduled count is 0");
  assert(schedule.completedChildrenCount === 1, "completed count is 1 (TICKET-1)");
  assert(schedule.totalPoints === 8, "total points is 8 (3 + 5)");
}

// --- Test 2: Partial Schedule Inference with Backlog Items (AC-004, FR-004) ---
{
  const partialDoc: RequirementsDocument = {
    ...baseDoc,
    relationships: [
      ...baseDoc.relationships,
      { id: "rel-3", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-3" },
    ],
  };

  const schedule = computeEpicInferredSchedule("EPIC-1", partialDoc, pis);
  assert(schedule.startDate === "2026-10-01", "partially scheduled epic still infers start date");
  assert(schedule.endDate === undefined, "partially scheduled epic has endDate strictly undefined");
  assert(schedule.isFullyScheduled === false, "partially scheduled epic has isFullyScheduled: false");
  assert(schedule.totalChildrenCount === 3, "total children count is 3");
  assert(schedule.scheduledChildrenCount === 2, "scheduled children count is 2");
  assert(schedule.unscheduledChildrenCount === 1, "unscheduled children count is 1");
  assert(schedule.totalPoints === 10, "total points is 10 (3 + 5 + 2)");
}

// --- Test 3: Epic with Zero Workable Items (DR-004) ---
{
  const schedule = computeEpicInferredSchedule("EPIC-2", baseDoc, pis);
  assert(schedule.startDate === undefined, "empty epic has startDate undefined");
  assert(schedule.endDate === undefined, "empty epic has endDate undefined");
  assert(schedule.isFullyScheduled === false, "empty epic has isFullyScheduled false");
  assert(schedule.totalChildrenCount === 0, "total children count is 0");
}

// --- Test 4: Dual-Milestone Epic Anchoring (FR-006, AC-009) ---
{
  const milestones: Milestone[] = [
    { id: "m-kickoff", type: "launch", name: "Epic Kickoff", scheduledAt: "2026-09-15", relatedItemIds: ["EPIC-2"] },
    { id: "m-target", type: "release", name: "Target Release", scheduledAt: "2026-11-30", relatedItemIds: ["EPIC-2"] },
  ];

  const schedule = computeEpicInferredSchedule("EPIC-2", baseDoc, pis, milestones);
  assert(schedule.startDate === "2026-09-15", "dual-milestone anchor infers start date from Kickoff milestone");
  assert(schedule.endDate === "2026-11-30", "dual-milestone anchor infers end date from Target Release milestone");
  assert(schedule.isFullyScheduled === true, "dual-milestone anchored epic is flagged as fully scheduled");
}

// --- Test 5: Child Workable Item Scheduled Across PIs ---
{
  const crossPIDoc: RequirementsDocument = {
    ...baseDoc,
    items: [
      ...baseDoc.items,
      { id: "TICKET-4", typeId: "ticket", title: "Cross PI work", body: "", sprintId: "sprint-3", points: 8 },
    ],
    relationships: [
      ...baseDoc.relationships,
      { id: "rel-4", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-4" },
    ],
  };

  const schedule = computeEpicInferredSchedule("EPIC-1", crossPIDoc, pis);
  assert(schedule.startDate === "2026-10-01", "start date is Sprint 1 start");
  assert(schedule.endDate === "2026-11-11", "end date spans into PI 2 Sprint 3 end (2026-11-11)");
  assert(schedule.isFullyScheduled === true, "isFullyScheduled is true");
  assert(schedule.scheduledSprintIds.includes("sprint-1") && schedule.scheduledSprintIds.includes("sprint-3"), "tracks all sprint IDs across PIs");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
