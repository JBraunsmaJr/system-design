/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/milestonesEndToEnd.verify.ts
 */
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES, isItemWorkable } from "./requirementsRegistry";
import type { RequirementsDocument } from "./requirementsTypes";
import type { ProgramIncrement } from "./programIncrements";
import { computeSprintDateRanges } from "./programIncrements";
import { computeEpicInferredSchedule } from "./epicScheduling";
import { computeSprintMilestoneSummary } from "./sprintSummaries";
import { validateMilestone, findMilestonesForItem, type Milestone } from "./milestones";
import { computeSprintCapacity } from "./teamCapacity";
import type { TeamDocument } from "./teamTypes";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 1. Setup Program Increments with contiguous sprint dates
const pi: ProgramIncrement = {
  id: "pi-1",
  name: "PI 2026-Q4",
  startDate: "2026-10-01",
  sprints: [
    { id: "sprint-1", name: "Sprint 1", durationDays: 14 }, // 2026-10-01 to 2026-10-14
    { id: "sprint-2", name: "Sprint 2", durationDays: 14 }, // 2026-10-15 to 2026-10-28
  ],
};

const sprintRanges = computeSprintDateRanges(pi);
const sprint1Range = sprintRanges.find((r) => r.sprintId === "sprint-1")!;

// 2. Setup Requirements Document with Epics, Dependencies, and Tickets
const doc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  items: [
    { id: "EPIC-1", typeId: "epic", title: "Enterprise SSO Auth", body: "" },
    { id: "DEP-1", typeId: "dependency", title: "Vendor Auth0 Tenant Provisioning", body: "" },
    { id: "TICKET-101", typeId: "ticket", title: "OAuth Login Gateway", body: "", sprintId: "sprint-1", points: 5, status: "done" },
    { id: "TICKET-102", typeId: "ticket", title: "SAML SSO Provider", body: "", sprintId: "sprint-2", points: 8, status: "in-progress" },
    { id: "TICKET-103", typeId: "ticket", title: "Audit Trail Logging", body: "", points: 3, status: "todo" }, // backlog / unscheduled
  ],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [
    { id: "r1", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-101" },
    { id: "r2", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-102" },
    { id: "r3", typeId: "depends-on", fromItemId: "TICKET-101", toItemId: "DEP-1" },
  ],
  nextSequence: {},
};

// 3. Setup Milestones linked to workable tickets, epics, and dependencies
const milestones: Milestone[] = [
  {
    id: "m-kickoff",
    type: "launch",
    name: "Enterprise Auth Kickoff",
    scheduledAt: "2026-09-28",
    relatedItemIds: ["EPIC-1"],
  },
  {
    id: "m-dep-deadline",
    type: "deadline",
    name: "Vendor API Ready",
    scheduledAt: "2026-10-05",
    relatedItemIds: ["DEP-1"],
  },
  {
    id: "m-rel30",
    type: "release",
    name: "Release 3.0",
    scheduledAt: "2026-10-28",
    version: "3.0.0",
    relatedItemIds: ["EPIC-1", "TICKET-101", "TICKET-102"],
  },
];

// --- Test 1: Milestone Linking to Diverse Types (AC-005, FR-005) ---
{
  for (const m of milestones) {
    const errors = validateMilestone(m, doc);
    assert(errors.length === 0, `Milestone '${m.name}' links validly across Epics, Dependencies, and Tickets`);
  }

  const epicMilestones = findMilestonesForItem(milestones, "EPIC-1");
  assert(epicMilestones.length === 2, "EPIC-1 is linked to 2 milestones (Kickoff and Release 3.0)");

  const depMilestones = findMilestonesForItem(milestones, "DEP-1");
  assert(depMilestones.length === 1 && depMilestones[0]?.id === "m-dep-deadline", "DEP-1 is linked to Vendor API Ready milestone");
}

// --- Test 2: Epic Inferred Schedule with 100% Scheduled Children (AC-003, DR-003) ---
{
  const schedule = computeEpicInferredSchedule("EPIC-1", doc, [pi], milestones);
  assert(schedule.startDate === "2026-09-28", "Epic start date accounts for Start Milestone (2026-09-28)");
  assert(schedule.endDate === "2026-10-28", "Epic end date infers from Sprint 2 end (2026-10-28)");
  assert(schedule.isFullyScheduled === true, "isFullyScheduled is true when all 2 child tickets are scheduled");
  assert(schedule.totalPoints === 13, "total points is 13 (5 + 8)");
  assert(schedule.completedChildrenCount === 1, "completed children count is 1 (TICKET-101)");
}

// --- Test 3: Epic Inferred Schedule with Unscheduled Child Item (AC-004, FR-004) ---
{
  const docWithUnscheduledChild: RequirementsDocument = {
    ...doc,
    relationships: [
      ...doc.relationships,
      { id: "r4", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-103" },
    ],
  };

  const schedule = computeEpicInferredSchedule("EPIC-1", docWithUnscheduledChild, [pi], milestones);
  assert(schedule.startDate === "2026-09-28", "Epic start date remains inferred");
  assert(schedule.endDate === undefined, "Epic end date is STRICTLY undefined when 1 child ticket is in backlog");
  assert(schedule.isFullyScheduled === false, "isFullyScheduled is false for partially scheduled epic");
  assert(schedule.unscheduledChildrenCount === 1, "unscheduledChildrenCount is 1");
  assert(schedule.totalPoints === 16, "total points is 16 (5 + 8 + 3)");
}

// --- Test 4: Sprint Milestone & Release Summaries (AC-006, FR-007) ---
{
  const summary1 = computeSprintMilestoneSummary(pi.sprints[0], sprint1Range, milestones, doc);
  assert(summary1.directMilestones.length === 1, "Sprint 1 has 1 direct milestone (Vendor API Ready on 2026-10-05)");
  assert(summary1.impactedReleases.length === 1, "Sprint 1 impacts Release 3.0");
  assert(summary1.impactedReleases[0]?.completionPercentage === 33, "Release 3.0 is 33% completed (1/3 items done: TICKET-101)");
  assert(summary1.externalDependencies.length === 1, "Sprint 1 identifies external dependency DEP-1");
}

// --- Test 5: Strict Zero Capacity Workload Invariant (DR-001, FR-008, AC-007) ---
{
  const team: TeamDocument = {
    settings: { defaultPointsPerDay: 1, excludeUsHolidays: false, extraDaysOff: [] },
    members: [{ id: "dev-1", name: "Bob", ptoSpans: [] }],
  };

  const sprint1WorkableItems = doc.items.filter((i) => i.sprintId === "sprint-1" && isItemWorkable(doc, i));
  const capacity1 = computeSprintCapacity(pi.sprints[0], sprint1Range, team, sprint1WorkableItems);

  assert(capacity1.totalAssignedPoints === 5, "Capacity assigned points is 5 (TICKET-101 only, no milestone/dependency workload)");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
