/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/milestones.verify.ts
 */
import {
  validateMilestone,
  sanitizeRelatedItemIds,
  getMilestoneColor,
  getMilestoneTypeLabel,
  filterMilestonesByDateRange,
  findMilestonesForWorkableItem,
  findMilestonesForItem,
  getMilestoneItems,
  getMilestoneWorkableItems,
  getMilestoneNonWorkableItems,
  filterMilestoneItemsByType,
  getMilestoneCapacityWorkload,
  type Milestone,
} from "./milestones";
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from "./requirementsRegistry";
import type { RequirementsDocument } from "./requirementsTypes";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const mockDoc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  items: [
    { id: "TICKET-1", typeId: "ticket", title: "Auth Feature", body: "", status: "todo" },
    { id: "TICKET-2", typeId: "ticket", title: "Database Migration", body: "", status: "todo" },
    { id: "REQ-1", typeId: "requirement", title: "Compliance Doc", body: "" },
    { id: "EPIC-1", typeId: "epic", title: "User Onboarding Epic", body: "" },
    { id: "DEP-1", typeId: "dependency", title: "Vendor SSO API", body: "" },
  ],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [],
  nextSequence: {},
};

// --- Test 1: Valid Release Creation (FR-001, AC-001, AC-006) ---
{
  const release: Partial<Milestone> = {
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    version: "2.4.0",
    description: "Major platform release",
  };
  const errors = validateMilestone(release, mockDoc);
  assert(errors.length === 0, "valid release without workable items passes validation");
}

// --- Test 2: Required Name Validation (FR-001, Section 12) ---
{
  const releaseWithoutName: Partial<Milestone> = {
    type: "release",
    name: "   ",
    scheduledAt: "2026-09-30",
  };
  const errors = validateMilestone(releaseWithoutName, mockDoc);
  assert(errors.some((e) => e.field === "name"), "empty name is rejected");
}

// --- Test 3: Required Date Validation (FR-001, FR-002, DR-002) ---
{
  const releaseWithoutDate: Partial<Milestone> = {
    type: "release",
    name: "Release 2.4",
    scheduledAt: "",
  };
  const errors = validateMilestone(releaseWithoutDate, mockDoc);
  assert(errors.some((e) => e.field === "scheduledAt"), "missing scheduled date is rejected");

  const releaseWithInvalidFormat: Partial<Milestone> = {
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026/09/30",
  };
  const formatErrors = validateMilestone(releaseWithInvalidFormat, mockDoc);
  assert(formatErrors.some((e) => e.field === "scheduledAt"), "non YYYY-MM-DD date format is rejected");
}

// --- Test 4: Related Items Validation (FR-005, AC-005, Section 12) ---
{
  const releaseWithValidItems: Partial<Milestone> = {
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    relatedItemIds: ["TICKET-1", "TICKET-2", "REQ-1"],
  };
  const errors = validateMilestone(releaseWithValidItems, mockDoc);
  assert(errors.length === 0, "referencing existing workable and non-workable items passes validation");

  const releaseWithNonexistentWork: Partial<Milestone> = {
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    relatedItemIds: ["TICKET-999"],
  };
  const nonExistErrors = validateMilestone(releaseWithNonexistentWork, mockDoc);
  assert(
    nonExistErrors.some((e) => e.field === "relatedItemIds" || e.field === "relatedWorkableItemIds"),
    "referencing non-existent item is rejected"
  );
}

// --- Test 5: Duplicate Relationship Prevention (Section 12) ---
{
  const sanitized = sanitizeRelatedItemIds(["TICKET-1", "TICKET-2", "TICKET-1", "", "  "]);
  assert(
    sanitized.length === 2 && sanitized[0] === "TICKET-1" && sanitized[1] === "TICKET-2",
    "sanitizeRelatedItemIds removes duplicates and blank entries"
  );
}

// --- Test 6: Zero Capacity / Workload Impact (FR-004, DR-004, AC-003) ---
{
  const release: Milestone = {
    id: "m-1",
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    version: "2.4.0",
    relatedWorkableItemIds: ["TICKET-1"],
  };
  assert(getMilestoneCapacityWorkload(release) === 0, "milestone capacity workload is strictly 0");
}

// --- Test 7: Date Range Filtering & Search (Section 13) ---
{
  const testList: Milestone[] = [
    { id: "m-1", type: "release", name: "R1", scheduledAt: "2026-01-10" },
    { id: "m-2", type: "release", name: "R2", scheduledAt: "2026-01-20" },
    { id: "m-3", type: "release", name: "R3", scheduledAt: "2026-02-05" },
  ];
  const inJan = filterMilestonesByDateRange(testList, "2026-01-01", "2026-01-31");
  assert(inJan.length === 2 && inJan[0]?.id === "m-1" && inJan[1]?.id === "m-2", "filters milestones correctly by date range");
}

// --- Test 8: Find Milestones by Workable Item (Section 13) ---
{
  const testList: Milestone[] = [
    { id: "m-1", type: "release", name: "R1", scheduledAt: "2026-01-10", relatedWorkableItemIds: ["TICKET-1"] },
    { id: "m-2", type: "release", name: "R2", scheduledAt: "2026-01-20", relatedWorkableItemIds: ["TICKET-2"] },
    { id: "m-3", type: "release", name: "R3", scheduledAt: "2026-02-05", relatedWorkableItemIds: ["TICKET-1", "TICKET-2"] },
  ];
  const forT1 = findMilestonesForWorkableItem(testList, "TICKET-1");
  assert(forT1.length === 2 && forT1[0]?.id === "m-1" && forT1[1]?.id === "m-3", "finds milestones associated with TICKET-1");
}

// --- Test 9: Color and Type Labels ---
{
  const release: Milestone = { id: "m-1", type: "release", name: "R1", scheduledAt: "2026-01-10" };
  const customMilestone: Milestone = { id: "m-2", type: "deadline", name: "D1", scheduledAt: "2026-01-10", color: "#123456" };
  assert(getMilestoneColor(release) === "#9061f9", "returns built-in default color for release");
  assert(getMilestoneColor(customMilestone) === "#123456", "returns custom color when specified");
  assert(getMilestoneTypeLabel("release") === "Release", "returns human readable label for release");
  assert(getMilestoneTypeLabel("code-freeze") === "Code Freeze", "returns human readable label for code-freeze");
}

// --- Test 10: Built-in Item Types & Relationship Types (FR-001, FR-002) ---
{
  const epicType = BUILT_IN_ITEM_TYPES.find((t) => t.id === "epic");
  assert(
    !!epicType && epicType.prefix === "EPIC" && epicType.isWorkable === false && epicType.color === "#8b5cf6",
    "built-in epic item type is defined as non-workable with prefix EPIC"
  );

  const depType = BUILT_IN_ITEM_TYPES.find((t) => t.id === "dependency");
  assert(
    !!depType && depType.prefix === "DEP" && depType.isWorkable === false && depType.color === "#f59e0b",
    "built-in dependency item type is defined as non-workable with prefix DEP"
  );

  const parentRel = BUILT_IN_RELATIONSHIP_TYPES.find((r) => r.id === "parent-of");
  assert(
    !!parentRel && parentRel.label === "Parent of" && parentRel.inverseLabel === "Child of" && parentRel.isBlocking === false,
    "built-in parent-of relationship type is defined"
  );

  const dependsRel = BUILT_IN_RELATIONSHIP_TYPES.find((r) => r.id === "depends-on");
  assert(
    !!dependsRel && dependsRel.label === "Depends on" && dependsRel.inverseLabel === "Depended on by" && dependsRel.isBlocking === true,
    "built-in depends-on relationship type is defined"
  );
}

// --- Test 11: Milestone Related Item Helper Functions (FR-005) ---
{
  const milestone: Milestone = {
    id: "m-test",
    type: "release",
    name: "Q4 Release",
    scheduledAt: "2026-11-15",
    relatedItemIds: ["EPIC-1", "DEP-1", "TICKET-1"],
  };

  const allItems = getMilestoneItems(milestone, mockDoc);
  assert(allItems.length === 3, "getMilestoneItems returns all 3 linked items");

  const workableItems = getMilestoneWorkableItems(milestone, mockDoc);
  assert(
    workableItems.length === 1 && workableItems[0]?.id === "TICKET-1",
    "getMilestoneWorkableItems returns only workable items"
  );

  const nonWorkableItems = getMilestoneNonWorkableItems(milestone, mockDoc);
  assert(
    nonWorkableItems.length === 2 &&
      nonWorkableItems.some((i) => i.id === "EPIC-1") &&
      nonWorkableItems.some((i) => i.id === "DEP-1"),
    "getMilestoneNonWorkableItems returns non-workable items (Epic and Dep)"
  );

  const epics = filterMilestoneItemsByType(milestone, mockDoc, "epic");
  assert(epics.length === 1 && epics[0]?.id === "EPIC-1", "filterMilestoneItemsByType filters by epic");

  const forDep = findMilestonesForItem([milestone], "DEP-1");
  assert(forDep.length === 1 && forDep[0]?.id === "m-test", "findMilestonesForItem finds milestone linked to DEP-1");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
