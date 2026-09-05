import {
  getUsFederalHolidays,
  parseISODate,
  formatISODate,
  getDayOfWeek,
  isWeekend,
  computeSprintCapacity,
  computePICapacities,
  calculateTotalPtoDays,
} from "./src/domain/teamCapacity.ts";
import { DEFAULT_TEAM_SETTINGS } from "./src/domain/teamTypes.ts";
import { getSprintActiveReservations } from "./src/domain/programIncrements.ts";
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

console.log("\n6. Testing Capacity Reservation - Percentage Deduction (User Prompt Example):");
// "If I have a reservation of 20%, and there are 10 points for each member in a sprint - that should equate to 8 points available for that member."
const teamTwoMembers = {
  settings: {
    defaultPointsPerDay: 1.0,
    excludeUsHolidays: false,
    extraDaysOff: [],
  },
  members: [
    { id: "u1", name: "Dev 1", defaultPointsPerDay: 1.0, ptoSpans: [] },
    { id: "u2", name: "Dev 2", defaultPointsPerDay: 1.0, ptoSpans: [] },
  ],
};
const twoWeekSprint = { id: "sprint-std", name: "Sprint 1", durationDays: 14 }; // 10 business days (Mon-Fri x 2)
const twoWeekRange = { startDate: "2026-10-05", endDate: "2026-10-18" }; // 10 business days, no holidays

const reservation20Percent = [
  { id: "r1", name: "Risk Reserve", unit: "percentage", value: 20 },
];

const capSummary20Pct = computeSprintCapacity(twoWeekSprint, twoWeekRange, teamTwoMembers, [], reservation20Percent);
assert(capSummary20Pct.grossCapacityPoints === 20, `Gross team capacity is 20 pts (actual: ${capSummary20Pct.grossCapacityPoints})`);
assert(capSummary20Pct.totalReservedPoints === 4, `Total reserved capacity is 4 pts (actual: ${capSummary20Pct.totalReservedPoints})`);
assert(capSummary20Pct.totalCapacityPoints === 16, `Total available net capacity is 16 pts (actual: ${capSummary20Pct.totalCapacityPoints})`);

const u1Cap = capSummary20Pct.memberBreakdown.find((m) => m.memberId === "u1");
const u2Cap = capSummary20Pct.memberBreakdown.find((m) => m.memberId === "u2");
assert(u1Cap.grossCapacityPoints === 10, `Dev 1 gross is 10 pts (actual: ${u1Cap.grossCapacityPoints})`);
assert(u1Cap.reservedPoints === 2, `Dev 1 reserved is 2 pts (actual: ${u1Cap.reservedPoints})`);
assert(u1Cap.capacityPoints === 8, `Dev 1 available capacity is 8 pts (actual: ${u1Cap.capacityPoints})`);
assert(u2Cap.capacityPoints === 8, `Dev 2 available capacity is 8 pts (actual: ${u2Cap.capacityPoints})`);

console.log("\n7. Testing Capacity Reservation - Whole Number / Fixed Points Deduction (Ceiled):");
const reservationFixedPoints = [
  { id: "r2", name: "Bug Backlog", unit: "points", value: 5 },
];
// 5 points split between 2 members with 10 pts gross each -> 2.5 pts raw -> ceil(2.5) = 3 pts reserved each.
// Total reserved = 6 pts, Total net capacity = 14 pts. All whole numbers!
const capSummaryFixed = computeSprintCapacity(twoWeekSprint, twoWeekRange, teamTwoMembers, [], reservationFixedPoints);
assert(capSummaryFixed.grossCapacityPoints === 20, `Gross team capacity is 20 pts (actual: ${capSummaryFixed.grossCapacityPoints})`);
assert(capSummaryFixed.totalReservedPoints === 6, `Total reserved capacity is 6 pts (actual: ${capSummaryFixed.totalReservedPoints})`);
assert(capSummaryFixed.totalCapacityPoints === 14, `Total available net capacity is 14 pts (actual: ${capSummaryFixed.totalCapacityPoints})`);
assert(capSummaryFixed.memberBreakdown[0].reservedPoints === 3, `Member 1 reserved points is 3 pts (actual: ${capSummaryFixed.memberBreakdown[0].reservedPoints})`);
assert(capSummaryFixed.memberBreakdown[0].capacityPoints === 7, `Member 1 available points is 7 pts (actual: ${capSummaryFixed.memberBreakdown[0].capacityPoints})`);

console.log("\n7b. Testing Fractional Percentage Reservations Ceiled to Whole Points:");
// 15% on 10 pts gross = 1.5 pts raw -> ceil(1.5) = 2 pts reserved, 8 pts available
const reservation15Pct = [{ id: "r-15", name: "Maintenance", unit: "percentage", value: 15 }];
const capSummary15Pct = computeSprintCapacity(twoWeekSprint, twoWeekRange, teamTwoMembers, [], reservation15Pct);
assert(capSummary15Pct.memberBreakdown[0].reservedPoints === 2, `15% on 10 pts gives 2 pts reserved (ceil) (actual: ${capSummary15Pct.memberBreakdown[0].reservedPoints})`);
assert(capSummary15Pct.memberBreakdown[0].capacityPoints === 8, `15% on 10 pts gives 8 pts available (actual: ${capSummary15Pct.memberBreakdown[0].capacityPoints})`);
assert(capSummary15Pct.totalReservedPoints === 4, `Total reserved is 4 pts (actual: ${capSummary15Pct.totalReservedPoints})`);
assert(capSummary15Pct.totalCapacityPoints === 16, `Total net is 16 pts (actual: ${capSummary15Pct.totalCapacityPoints})`);

console.log("\n8. Testing Multiple Combined Reservations (Percentage + Fixed):");
const multipleReservations = [
  { id: "r-risk", name: "Risk Buffer", unit: "percentage", value: 10 },
  { id: "r-tech", name: "Tech Debt", unit: "percentage", value: 10 },
  { id: "r-ops", name: "Ops Buffer", unit: "points", value: 2 },
];
// Total percent = 20% (4 pts), fixed = 2 pts. Total reserved = 6 pts, Net = 14 pts.
// Each member: 10 * 0.20 + 2 * (10/20) = 2 + 1 = 3 pts reserved -> 7 pts net.
const capSummaryMulti = computeSprintCapacity(twoWeekSprint, twoWeekRange, teamTwoMembers, [], multipleReservations);
assert(capSummaryMulti.grossCapacityPoints === 20, `Multi: Gross is 20 pts (actual: ${capSummaryMulti.grossCapacityPoints})`);
assert(capSummaryMulti.totalReservedPoints === 6, `Multi: Total reserved is 6 pts (actual: ${capSummaryMulti.totalReservedPoints})`);
assert(capSummaryMulti.totalCapacityPoints === 14, `Multi: Net available is 14 pts (actual: ${capSummaryMulti.totalCapacityPoints})`);
assert(capSummaryMulti.memberBreakdown[0].reservedPoints === 3, `Multi: Member 1 reserved is 3 pts (actual: ${capSummaryMulti.memberBreakdown[0].reservedPoints})`);
assert(capSummaryMulti.memberBreakdown[0].capacityPoints === 7, `Multi: Member 1 available is 7 pts (actual: ${capSummaryMulti.memberBreakdown[0].capacityPoints})`);

console.log("\n9. Testing PI-level vs Granular Sprint-level Scoping:");
const piTest = {
  id: "pi-1",
  name: "PI 1",
  startDate: "2026-10-05",
  sprints: [
    { id: "sp-1", name: "Sprint 1", durationDays: 14 },
    { id: "sp-2", name: "Sprint 2", durationDays: 14 },
  ],
  reservations: [
    // PI-wide reservation (applies to both sprints)
    { id: "r-pi", name: "General 10% Reserve", unit: "percentage", value: 10 },
    // Sprint 2 specific reservation (only applies to sprint 2)
    { id: "r-sp2", name: "Sprint 2 Hardening Buffer", unit: "points", value: 4, sprintId: "sp-2" },
  ],
};

const sp1ActiveRes = getSprintActiveReservations(piTest.reservations, "sp-1");
const sp2ActiveRes = getSprintActiveReservations(piTest.reservations, "sp-2");

assert(sp1ActiveRes.length === 1 && sp1ActiveRes[0].id === "r-pi", "Sprint 1 gets only the PI-level reservation");
assert(sp2ActiveRes.length === 2, "Sprint 2 gets both the PI-level and sprint-specific reservations");

const piRanges = [
  { sprintId: "sp-1", startDate: "2026-10-05", endDate: "2026-10-18" },
  { sprintId: "sp-2", startDate: "2026-10-19", endDate: "2026-11-01" },
];
const piSummaries = computePICapacities(piTest, piRanges, teamTwoMembers, []);
// Sprint 1: 20 gross, 10% (2 pts) reserved -> 18 net
assert(piSummaries[0].grossCapacityPoints === 20 && piSummaries[0].totalReservedPoints === 2 && piSummaries[0].totalCapacityPoints === 18, `Sprint 1 capacity is 18 pts net (actual: ${piSummaries[0].totalCapacityPoints})`);
// Sprint 2: 20 gross, 10% (2 pts) + 4 pts = 6 pts reserved -> 14 net
assert(piSummaries[1].grossCapacityPoints === 20 && piSummaries[1].totalReservedPoints === 6 && piSummaries[1].totalCapacityPoints === 14, `Sprint 2 capacity is 14 pts net (actual: ${piSummaries[1].totalCapacityPoints})`);

console.log("\n10. Testing Serialization of ProgramIncrement.reservations:");
const diagramWithReservations = toDiagramFile("Test PI Reserves", [], [], [], EMPTY_REQUIREMENTS_DOCUMENT, [piTest], teamTwoMembers);
const parsedDiagram = parseDiagramFile(JSON.stringify(diagramWithReservations));
assert(parsedDiagram.programIncrements.length === 1, "Parsed diagram contains 1 PI");
assert(parsedDiagram.programIncrements[0].reservations.length === 2, "Parsed diagram retains 2 capacity reservations");
assert(parsedDiagram.programIncrements[0].reservations[0].name === "General 10% Reserve", "Parsed reservation retains name");
assert(parsedDiagram.programIncrements[0].reservations[1].sprintId === "sp-2", "Parsed reservation retains sprintId");

console.log("\n11. Testing PI Header Capacity Totals Aggregation:");
// In piSummaries:
// Sprint 1: Gross 20, Reserved 2, Total Net 18, Assigned 0
// Sprint 2: Gross 20, Reserved 6, Total Net 14, Assigned 0
// Total PI: Gross 40, Reserved 8, Total Net 32
const piTotalGross = piSummaries.reduce((sum, s) => sum + s.grossCapacityPoints, 0);
const piTotalReserved = piSummaries.reduce((sum, s) => sum + s.totalReservedPoints, 0);
const piTotalCapacity = piSummaries.reduce((sum, s) => sum + s.totalCapacityPoints, 0);
assert(piTotalGross === 40, `PI total gross capacity is 40 pts (actual: ${piTotalGross})`);
assert(piTotalReserved === 8, `PI total reserved capacity is 8 pts (actual: ${piTotalReserved})`);
assert(piTotalCapacity === 32, `PI total net available capacity is 32 pts (actual: ${piTotalCapacity})`);

console.log("\n------------------------------------------------");
console.log(`Test results: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
