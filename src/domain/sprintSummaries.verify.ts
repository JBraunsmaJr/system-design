/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/sprintSummaries.verify.ts
 */
import { computeSprintMilestoneSummary, computePIMilestoneSummaries } from "./sprintSummaries";
import { computeSprintCapacity } from "./teamCapacity";
import type { Sprint, SprintDateRange, ProgramIncrement } from "./programIncrements";
import type { Milestone } from "./milestones";
import type { RequirementsDocument } from "./requirementsTypes";
import type { TeamDocument } from "./teamTypes";
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

const sprint1: Sprint = { id: "sprint-1", name: "Sprint 1", durationDays: 14 };
const range1: SprintDateRange = { sprintId: "sprint-1", startDate: "2026-10-01", endDate: "2026-10-14" };

const sprint2: Sprint = { id: "sprint-2", name: "Sprint 2", durationDays: 14 };
const range2: SprintDateRange = { sprintId: "sprint-2", startDate: "2026-10-15", endDate: "2026-10-28" };

const pi: ProgramIncrement = {
  id: "pi-1",
  name: "PI 1",
  startDate: "2026-10-01",
  sprints: [sprint1, sprint2],
};

const mockDoc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  items: [
    { id: "EPIC-1", typeId: "epic", title: "Enterprise Auth", body: "" },
    { id: "TICKET-1", typeId: "ticket", title: "Core Auth", body: "", sprintId: "sprint-1", points: 5, status: "done" },
    { id: "TICKET-2", typeId: "ticket", title: "OAuth Provider", body: "", sprintId: "sprint-1", points: 3, status: "in-progress" },
    { id: "TICKET-3", typeId: "ticket", title: "SAML SSO", body: "", sprintId: "sprint-2", points: 8, status: "todo" },
    { id: "DEP-1", typeId: "dependency", title: "Identity Provider Vendor API", body: "" },
  ],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [
    { id: "rel-epic-1", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-1" },
    { id: "rel-epic-2", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-2" },
    { id: "rel-epic-3", typeId: "parent-of", fromItemId: "EPIC-1", toItemId: "TICKET-3" },
    { id: "rel-1", typeId: "depends-on", fromItemId: "TICKET-2", toItemId: "DEP-1" },
  ],
  nextSequence: {},
};

const milestones: Milestone[] = [
  // Direct milestone during Sprint 1
  { id: "m-freeze", type: "code-freeze", name: "Alpha Freeze", scheduledAt: "2026-10-10" },
  // Release milestone linked to TICKET-1, TICKET-2, TICKET-3
  { id: "m-rel24", type: "release", name: "Release 2.4", scheduledAt: "2026-11-01", relatedItemIds: ["TICKET-1", "TICKET-2", "TICKET-3"] },
];

// --- Test 1: Direct Milestone Aggregation (FR-007, Scenario 4) ---
{
  const summary1 = computeSprintMilestoneSummary(sprint1, range1, milestones, mockDoc);
  assert(summary1.directMilestones.length === 1, "Sprint 1 has 1 direct milestone");
  assert(summary1.directMilestones[0]?.id === "m-freeze", "Sprint 1 direct milestone is Alpha Freeze");
}

// --- Test 2: Impacted Release Aggregation (FR-007) ---
{
  const summary1 = computeSprintMilestoneSummary(sprint1, range1, milestones, mockDoc);
  assert(summary1.impactedReleases.length === 1, "Sprint 1 impacts Release 2.4");
  const relInfo = summary1.impactedReleases[0];
  assert(relInfo?.milestone.id === "m-rel24", "impacted release is Release 2.4");
  assert(relInfo?.relatedItemsInSprint.length === 2, "Sprint 1 contains 2 items linked to Release 2.4");
  assert(relInfo?.totalRelatedItemsCount === 3, "Release 2.4 has 3 total related items");
  assert(relInfo?.isFullyContainedInSprint === false, "Release 2.4 is not fully contained in Sprint 1");
  assert(relInfo?.completionPercentage === 33, "Release 2.4 completion is 33% (1/3 done)");
}

// --- Test 3: External Non-Workable Dependency Detection (FR-005, Scenario 3) ---
{
  const summary1 = computeSprintMilestoneSummary(sprint1, range1, milestones, mockDoc);
  assert(summary1.externalDependencies.length === 1, "Sprint 1 identifies 1 external dependency");
  assert(summary1.externalDependencies[0]?.id === "DEP-1", "External dependency is DEP-1");
}

// --- Test 3b: Impacted Epics Progression Detection ---
{
  const summary1 = computeSprintMilestoneSummary(sprint1, range1, milestones, mockDoc);
  assert(summary1.impactedEpics.length === 1, "Sprint 1 identifies 1 impacted Epic");
  const epicInfo = summary1.impactedEpics[0];
  assert(epicInfo?.epic.id === "EPIC-1", "Impacted Epic is EPIC-1");
  assert(epicInfo?.itemsInSprint.length === 2, "Sprint 1 contains 2 items for EPIC-1");
  assert(epicInfo?.totalChildrenCount === 3, "EPIC-1 has 3 total children");
  assert(epicInfo?.completedChildrenCount === 1, "EPIC-1 has 1 completed child");
  assert(epicInfo?.completionPercentage === 33, "EPIC-1 completion is 33%");
}

// --- Test 4: Capacity Workload Invariance (DR-001, FR-008, AC-007) ---
{
  const team: TeamDocument = {
    settings: { defaultPointsPerDay: 1, excludeUsHolidays: false, extraDaysOff: [] },
    members: [{ id: "dev-1", name: "Alice", ptoSpans: [] }],
  };

  const capacitySummary = computeSprintCapacity(
    sprint1,
    range1,
    team,
    mockDoc.items.filter((i) => i.sprintId === "sprint-1")
  );

  assert(capacitySummary.totalAssignedPoints === 8, "total assigned capacity points strictly equals ticket points (5 + 3 = 8)");
}

// --- Test 5: PI-wide Summaries Computation ---
{
  const piSummaries = computePIMilestoneSummaries(pi, [range1, range2], milestones, mockDoc);
  assert(piSummaries.has("sprint-1"), "PI summaries contains sprint-1");
  assert(piSummaries.has("sprint-2"), "PI summaries contains sprint-2");
  const s2Summary = piSummaries.get("sprint-2")!;
  assert(s2Summary.directMilestones.length === 0, "Sprint 2 has 0 direct milestones");
  assert(s2Summary.impactedReleases.length === 1, "Sprint 2 impacts Release 2.4");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
