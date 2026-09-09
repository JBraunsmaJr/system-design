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
  getMilestoneCapacityWorkload,
  type Milestone,
} from "./milestones";
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
  itemTypes: [
    { id: "ticket", label: "Ticket", prefix: "TICKET", color: "#22B8CF", isBuiltIn: true, isWorkable: true },
    { id: "requirement", label: "Requirement", prefix: "REQ", color: "#5b7cfa", isBuiltIn: true, isWorkable: false },
  ],
  categories: [],
  items: [
    { id: "TICKET-1", typeId: "ticket", title: "Auth Feature", body: "", status: "todo" },
    { id: "TICKET-2", typeId: "ticket", title: "Database Migration", body: "", status: "todo" },
    { id: "REQ-1", typeId: "requirement", title: "Compliance Doc", body: "" },
  ],
  relationshipTypes: [],
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

// --- Test 4: Related Workable Items Validation (AC-007, Section 12) ---
{
  const releaseWithValidWork: Partial<Milestone> = {
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    relatedWorkableItemIds: ["TICKET-1", "TICKET-2"],
  };
  const errors = validateMilestone(releaseWithValidWork, mockDoc);
  assert(errors.length === 0, "referencing existing workable items passes validation");

  const releaseWithNonexistentWork: Partial<Milestone> = {
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    relatedWorkableItemIds: ["TICKET-999"],
  };
  const nonExistErrors = validateMilestone(releaseWithNonexistentWork, mockDoc);
  assert(
    nonExistErrors.some((e) => e.field === "relatedWorkableItemIds"),
    "referencing non-existent item is rejected"
  );

  const releaseWithNonWorkableItem: Partial<Milestone> = {
    type: "release",
    name: "Release 2.4",
    scheduledAt: "2026-09-30",
    relatedWorkableItemIds: ["REQ-1"],
  };
  const nonWorkableErrors = validateMilestone(releaseWithNonWorkableItem, mockDoc);
  assert(
    nonWorkableErrors.some((e) => e.field === "relatedWorkableItemIds"),
    "referencing non-workable item (REQ-1) is rejected"
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

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
