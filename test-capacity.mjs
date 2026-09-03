import {
  getUsFederalHolidays,
  parseISODate,
  formatISODate,
  getDayOfWeek,
  isWeekend,
  computeSprintCapacity,
  calculateTotalPtoDays,
} from "./src/domain/teamCapacity.ts";
import { DEFAULT_TEAM_SETTINGS } from "./src/domain/teamTypes.ts";
import { toDiagramFile, parseDiagramFile } from "./src/domain/serialization.ts";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "./src/domain/requirementsTypes.ts";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log("\n1. Testing US Federal Holidays Calculation:");
const h2026 = getUsFederalHolidays(2026);
assert(h2026.length === 11, "Calculates 11 federal holidays for 2026");
assert(h2026.some((h) => h.name === "New Year's Day" && h.date === "2026-01-01"), "New Year's Day 2026 is Jan 1");
assert(h2026.some((h) => h.name === "Independence Day" && h.date === "2026-07-03"), "July 4 on Saturday is observed Friday July 3");
assert(h2026.some((h) => h.name === "Thanksgiving Day" && h.date === "2026-11-26"), "Thanksgiving 2026 is 4th Thursday (Nov 26)");

console.log("\n2. Testing Date and Weekend Helpers:");
assert(parseISODate("2026-09-02") === parseISODate(formatISODate(parseISODate("2026-09-02"))), "Roundtrip ISO date parse/format");
assert(isWeekend(parseISODate("2026-09-05")), "2026-09-05 is Saturday (weekend)");
assert(isWeekend(parseISODate("2026-09-06")), "2026-09-06 is Sunday (weekend)");
assert(!isWeekend(parseISODate("2026-09-07")), "2026-09-07 is Monday (weekday, though Labor Day)");

console.log("\n3. Testing Sprint Capacity and 1/2 Day PTO Spans:");
const team = {
  settings: {
    defaultPointsPerDay: 1.0,
    excludeUsHolidays: true,
    extraDaysOff: [
      { id: "extra-1", name: "Company Retreat", date: "2026-09-18", isHalfDay: false },
      { id: "extra-2", name: "Early Friday", date: "2026-09-25", isHalfDay: true },
    ],
  },
  members: [
    {
      id: "mem-1",
      name: "Alice",
      defaultPointsPerDay: 1.0,
      ptoSpans: [
        // Half-day PTO (morning)
        { id: "pto-1", startDate: "2026-09-08", endDate: "2026-09-08", startHalfDay: "morning", endHalfDay: "morning" },
        // Multi-day PTO with half-day start afternoon and half-day end morning:
        // Sept 14 (afternoon = 0.5d), Sept 15 (full = 1.0d), Sept 16 (morning = 0.5d) -> 2.0 days total PTO
        { id: "pto-2", startDate: "2026-09-14", endDate: "2026-09-16", startHalfDay: "afternoon", endHalfDay: "morning" },
      ],
    },
    {
      id: "mem-2",
      name: "Bob (Part Time / Contractor)",
      defaultPointsPerDay: 2.0, // 2 points per business day
      ptoSpans: [],
    },
  ],
};

const sprint = { id: "sprint-1", name: "Sprint 1", durationDays: 14 }; // 2-week sprint: Sept 7 - Sept 20 (14 days inclusive: Sept 7 to Sept 20)
const sprintRange = { startDate: "2026-09-07", endDate: "2026-09-20" };

// Business days in Sept 7 - Sept 20:
// Sept 7: Labor Day (US Holiday) -> 0
// Sept 8-11: 4 business days
// Sept 12-13: Weekend
// Sept 14-17: 4 business days
// Sept 18: Company Retreat (Extra full day off) -> 0
// Sept 19-20: Weekend
// Total sprint business days = 4 + 4 = 8 business days.

const items = [
  { id: "REQ-1", typeId: "feat", title: "Feature 1", body: "", sprintId: "sprint-1", assigneeId: "mem-1", points: 3 },
  { id: "REQ-2", typeId: "feat", title: "Feature 2", body: "", sprintId: "sprint-1", assigneeId: "mem-1", points: 2 },
  { id: "REQ-3", typeId: "feat", title: "Feature 3", body: "", sprintId: "sprint-1", assigneeId: "mem-2", points: 10 },
  { id: "REQ-4", typeId: "feat", title: "Unassigned Story", body: "", sprintId: "sprint-1", points: 2 },
];

const summary = computeSprintCapacity(sprint, sprintRange, team, items);

assert(summary.sprintBusinessDays === 8, `Sprint business days is 8 (actual: ${summary.sprintBusinessDays})`);
const aliceCap = summary.memberBreakdown.find((m) => m.memberId === "mem-1");
// Alice PTO in this sprint:
// Sept 8: 0.5d
// Sept 14 (0.5d) + Sept 15 (1.0d) + Sept 16 (0.5d) = 2.0d
// Total Alice PTO in sprint = 2.5d
// Alice available working days = 8 - 2.5 = 5.5d
// Alice capacity points = 5.5 * 1.0 = 5.5 pts
// Alice assigned points = 3 + 2 = 5 pts
// Alice remaining points = 5.5 - 5 = 0.5 pts
assert(aliceCap.ptoDays === 2.5, `Alice PTO days in sprint is 2.5 (actual: ${aliceCap.ptoDays})`);
assert(aliceCap.workingDays === 5.5, `Alice working days in sprint is 5.5 (actual: ${aliceCap.workingDays})`);
assert(aliceCap.capacityPoints === 5.5, `Alice capacity is 5.5 pts (actual: ${aliceCap.capacityPoints})`);
assert(aliceCap.assignedPoints === 5, `Alice assigned points is 5 pts (actual: ${aliceCap.assignedPoints})`);
assert(aliceCap.remainingPoints === 0.5, `Alice remaining points is 0.5 pts (actual: ${aliceCap.remainingPoints})`);

const bobCap = summary.memberBreakdown.find((m) => m.memberId === "mem-2");
// Bob working days = 8d, Bob rate = 2.0 pts/day -> 16 pts
// Bob assigned = 10 pts, remaining = 6 pts
assert(bobCap.workingDays === 8, `Bob working days is 8 (actual: ${bobCap.workingDays})`);
assert(bobCap.capacityPoints === 16, `Bob capacity is 16 pts (actual: ${bobCap.capacityPoints})`);
assert(bobCap.assignedPoints === 10, `Bob assigned points is 10 (actual: ${bobCap.assignedPoints})`);
assert(bobCap.remainingPoints === 6, `Bob remaining points is 6 (actual: ${bobCap.remainingPoints})`);

// Total team capacity = 5.5 + 16 = 21.5 pts
// Total assigned points = 5 + 10 + 2 (unassigned) = 17 pts
// Remaining team capacity = 21.5 - 17 = 4.5 pts
assert(summary.totalCapacityPoints === 21.5, `Team total capacity is 21.5 pts (actual: ${summary.totalCapacityPoints})`);
assert(summary.totalAssignedPoints === 17, `Team total assigned points is 17 pts (actual: ${summary.totalAssignedPoints})`);
assert(summary.unassignedPoints === 2, `Team unassigned points is 2 pts (actual: ${summary.unassignedPoints})`);
assert(summary.remainingCapacityPoints === 4.5, `Team remaining capacity is 4.5 pts (actual: ${summary.remainingCapacityPoints})`);

console.log("\n4. Testing Total PTO Days Calculation:");
assert(calculateTotalPtoDays(team.members[0]) === 2.5, `Total PTO days for Alice is 2.5 (actual: ${calculateTotalPtoDays(team.members[0])})`);

console.log("\n5. Testing File Serialization and Deserialization:");
const serialized = toDiagramFile("Test Arch", [], [], [], EMPTY_REQUIREMENTS_DOCUMENT, [], team);
const parsed = parseDiagramFile(JSON.stringify(serialized));
assert(parsed.team.members.length === 2, "Parsed file retains 2 team members");
assert(parsed.team.settings.extraDaysOff.length === 2, "Parsed file retains 2 extra days off");
assert(parsed.team.members[0].ptoSpans.length === 2, "Parsed file retains 2 PTO spans");

console.log("\n------------------------------------------------");
console.log(`Test results: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
