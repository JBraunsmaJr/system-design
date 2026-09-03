import type {
  TeamDocument,
  TeamMember,
  PtoSpan,
  ExtraDayOff,
  MemberSprintCapacity,
  SprintCapacitySummary,
} from "./teamTypes";
import type { Sprint, ProgramIncrement } from "./programIncrements";
import type { RequirementItem } from "./requirementsTypes";

export interface HolidayInfo {
  date: string; // YYYY-MM-DD
  name: string;
}

/** Converts a YYYY-MM-DD string to a day count (UTC-based days since Unix epoch). */
export function parseISODate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Formats UTC day count to YYYY-MM-DD. */
export function formatISODate(days: number): string {
  const d = new Date(days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Returns UTC day of week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday */
export function getDayOfWeek(days: number): number {
  const d = new Date(days * 86400000);
  return d.getUTCDay();
}

/** Returns true if date falls on Saturday (6) or Sunday (0) */
export function isWeekend(days: number): boolean {
  const dow = getDayOfWeek(days);
  return dow === 0 || dow === 6;
}

/**
 * Calculates standard US Federal Holidays for a given year,
 * including observed date rules (Sat -> Fri, Sun -> Mon).
 */
export function getUsFederalHolidays(year: number): HolidayInfo[] {
  const holidays: HolidayInfo[] = [];

  const addObservedFixedHoliday = (name: string, month: number, day: number) => {
    const exactDays = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
    const dow = getDayOfWeek(exactDays);
    let observedDays = exactDays;
    if (dow === 6) {
      // Saturday -> observed on Friday
      observedDays = exactDays - 1;
    } else if (dow === 0) {
      // Sunday -> observed on Monday
      observedDays = exactDays + 1;
    }
    holidays.push({ date: formatISODate(observedDays), name });
  };

  const addNthWeekdayHoliday = (
    name: string,
    month: number,
    targetDow: number, // 0 = Sun, 1 = Mon, ..., 4 = Thu
    nth: number // 1-based, e.g. 1st, 2nd, 3rd, 4th
  ) => {
    let days = Math.floor(Date.UTC(year, month - 1, 1) / 86400000);
    while (getDayOfWeek(days) !== targetDow) {
      days += 1;
    }
    days += (nth - 1) * 7;
    holidays.push({ date: formatISODate(days), name });
  };

  const addLastWeekdayHoliday = (name: string, month: number, targetDow: number) => {
    // Start at last day of month
    const nextMonthDays = Math.floor(Date.UTC(year, month, 1) / 86400000);
    let days = nextMonthDays - 1;
    while (getDayOfWeek(days) !== targetDow) {
      days -= 1;
    }
    holidays.push({ date: formatISODate(days), name });
  };

  // 1. New Year's Day (Jan 1)
  addObservedFixedHoliday("New Year's Day", 1, 1);

  // 2. Martin Luther King Jr. Day (3rd Monday in Jan)
  addNthWeekdayHoliday("Martin Luther King Jr. Day", 1, 1, 3);

  // 3. Washington's Birthday / Presidents' Day (3rd Monday in Feb)
  addNthWeekdayHoliday("Presidents' Day", 2, 1, 3);

  // 4. Memorial Day (Last Monday in May)
  addLastWeekdayHoliday("Memorial Day", 5, 1);

  // 5. Juneteenth National Independence Day (June 19)
  addObservedFixedHoliday("Juneteenth", 6, 19);

  // 6. Independence Day (July 4)
  addObservedFixedHoliday("Independence Day", 7, 4);

  // 7. Labor Day (1st Monday in Sept)
  addNthWeekdayHoliday("Labor Day", 9, 1, 1);

  // 8. Columbus Day / Indigenous Peoples' Day (2nd Monday in Oct)
  addNthWeekdayHoliday("Columbus Day", 10, 1, 2);

  // 9. Veterans Day (Nov 11)
  addObservedFixedHoliday("Veterans Day", 11, 11);

  // 10. Thanksgiving Day (4th Thursday in Nov)
  addNthWeekdayHoliday("Thanksgiving Day", 11, 4, 4);

  // 11. Christmas Day (Dec 25)
  addObservedFixedHoliday("Christmas Day", 12, 25);

  return holidays;
}

/**
 * Gets all holidays in a given date range (covers multi-year spans seamlessly).
 */
export function getHolidaysInRange(startDays: number, endDays: number): Map<string, string> {
  const startYear = new Date(startDays * 86400000).getUTCFullYear();
  const endYear = new Date(endDays * 86400000).getUTCFullYear();
  const holidayMap = new Map<string, string>();

  for (let y = startYear - 1; y <= endYear + 1; y++) {
    const list = getUsFederalHolidays(y);
    for (const h of list) {
      holidayMap.set(h.date, h.name);
    }
  }

  return holidayMap;
}

/**
 * Calculates PTO deduction for a member on a specific date (in UTC days).
 * Takes into account start/end half-days (0.5 vs 1.0 day).
 */
export function getMemberPtoDeductionForDay(ptoSpans: PtoSpan[], currentDays: number): number {
  let totalDeduction = 0;

  for (const span of ptoSpans) {
    const spanStart = parseISODate(span.startDate);
    const spanEnd = parseISODate(span.endDate);

    if (currentDays < spanStart || currentDays > spanEnd) {
      continue;
    }

    if (spanStart === spanEnd) {
      // Single-day PTO
      if (span.startHalfDay === "full") {
        totalDeduction += 1.0;
      } else {
        // morning or afternoon = 0.5 day
        totalDeduction += 0.5;
      }
    } else {
      // Multi-day PTO
      if (currentDays === spanStart) {
        // On start day: 'afternoon' means starting afternoon off (0.5 day off); 'full' or 'morning' means full day off
        totalDeduction += span.startHalfDay === "afternoon" ? 0.5 : 1.0;
      } else if (currentDays === spanEnd) {
        // On end day: 'morning' means morning off (0.5 day off); 'full' or 'afternoon' means full day off
        totalDeduction += span.endHalfDay === "morning" ? 0.5 : 1.0;
      } else {
        // Intermediate day
        totalDeduction += 1.0;
      }
    }
  }

  return Math.min(1.0, totalDeduction);
}

/**
 * Calculates capacity breakdown for each team member and the sprint as a whole.
 */
export function computeSprintCapacity(
  sprint: Sprint,
  sprintRange: { startDate: string; endDate: string } | undefined,
  team: TeamDocument,
  items: RequirementItem[]
): SprintCapacitySummary {
  if (!sprintRange) {
    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      durationDays: sprint.durationDays,
      sprintBusinessDays: 0,
      totalCapacityPoints: 0,
      totalAssignedPoints: 0,
      unassignedPoints: 0,
      remainingCapacityPoints: 0,
      memberBreakdown: [],
    };
  }

  const startDays = parseISODate(sprintRange.startDate);
  const endDays = parseISODate(sprintRange.endDate);

  const holidaysMap = team.settings.excludeUsHolidays
    ? getHolidaysInRange(startDays, endDays)
    : new Map<string, string>();

  const extraDaysMap = new Map<string, ExtraDayOff>();
  for (const extra of team.settings.extraDaysOff) {
    extraDaysMap.set(extra.date, extra);
  }

  // First, calculate total available business days in the sprint
  let sprintBusinessDays = 0;
  // Day-by-day company base working hours (1.0, 0.5, or 0.0)
  const dayBaseAvailability: { days: number; available: number }[] = [];

  for (let d = startDays; d <= endDays; d++) {
    if (isWeekend(d)) {
      dayBaseAvailability.push({ days: d, available: 0 });
      continue;
    }

    const iso = formatISODate(d);

    // Check US holiday
    if (holidaysMap.has(iso)) {
      dayBaseAvailability.push({ days: d, available: 0 });
      continue;
    }

    // Check custom extra day off
    const extra = extraDaysMap.get(iso);
    if (extra) {
      const avail = extra.isHalfDay ? 0.5 : 0;
      sprintBusinessDays += avail;
      dayBaseAvailability.push({ days: d, available: avail });
      continue;
    }

    // Normal business day
    sprintBusinessDays += 1.0;
    dayBaseAvailability.push({ days: d, available: 1.0 });
  }

  // Next, calculate assigned points per member and unassigned in this sprint
  const sprintItems = items.filter((item) => item.sprintId === sprint.id);
  const memberAssignedPoints = new Map<string, number>();
  const memberAssignedCount = new Map<string, number>();
  let unassignedPoints = 0;

  for (const item of sprintItems) {
    const pts = typeof item.points === "number" && !isNaN(item.points) ? item.points : 0;
    if (item.assigneeId) {
      memberAssignedPoints.set(item.assigneeId, (memberAssignedPoints.get(item.assigneeId) ?? 0) + pts);
      memberAssignedCount.set(item.assigneeId, (memberAssignedCount.get(item.assigneeId) ?? 0) + 1);
    } else {
      unassignedPoints += pts;
    }
  }

  const memberBreakdown: MemberSprintCapacity[] = [];
  let totalCapacityPoints = 0;
  let totalAssignedPoints = 0;

  for (const member of team.members) {
    const pointsPerDay =
      typeof member.defaultPointsPerDay === "number"
        ? member.defaultPointsPerDay
        : team.settings.defaultPointsPerDay;

    let memberWorkingDays = 0;
    let memberPtoDays = 0;

    for (const { days, available } of dayBaseAvailability) {
      if (available <= 0) {
        continue;
      }
      const ptoDeduction = getMemberPtoDeductionForDay(member.ptoSpans, days);
      const effectivePto = Math.min(available, ptoDeduction);
      const working = available - effectivePto;

      memberPtoDays += effectivePto;
      memberWorkingDays += working;
    }

    const capacityPoints = Math.round(memberWorkingDays * pointsPerDay * 10) / 10;
    const assignedPts = memberAssignedPoints.get(member.id) ?? 0;
    const assignedCount = memberAssignedCount.get(member.id) ?? 0;
    const remainingPts = Math.round((capacityPoints - assignedPts) * 10) / 10;

    totalCapacityPoints += capacityPoints;
    totalAssignedPoints += assignedPts;

    memberBreakdown.push({
      memberId: member.id,
      memberName: member.name,
      memberRole: member.role,
      avatarColor: member.avatarColor,
      pointsPerDay,
      sprintBusinessDays,
      ptoDays: Math.round(memberPtoDays * 10) / 10,
      workingDays: Math.round(memberWorkingDays * 10) / 10,
      capacityPoints,
      assignedPoints: assignedPts,
      remainingPoints: remainingPts,
      assignedItemCount: assignedCount,
    });
  }

  // Include unassigned points in totalAssignedPoints
  totalAssignedPoints += unassignedPoints;
  totalCapacityPoints = Math.round(totalCapacityPoints * 10) / 10;
  totalAssignedPoints = Math.round(totalAssignedPoints * 10) / 10;
  const remainingCapacityPoints = Math.round((totalCapacityPoints - totalAssignedPoints) * 10) / 10;

  return {
    sprintId: sprint.id,
    sprintName: sprint.name,
    startDate: sprintRange.startDate,
    endDate: sprintRange.endDate,
    durationDays: sprint.durationDays,
    sprintBusinessDays: Math.round(sprintBusinessDays * 10) / 10,
    totalCapacityPoints,
    totalAssignedPoints,
    unassignedPoints,
    remainingCapacityPoints,
    memberBreakdown,
  };
}

/**
 * Computes capacity summaries across all sprints in a program increment.
 */
export function computePICapacities(
  pi: ProgramIncrement,
  sprintRanges: { sprintId: string; startDate: string; endDate: string }[],
  team: TeamDocument,
  items: RequirementItem[]
): SprintCapacitySummary[] {
  const rangeMap = new Map(sprintRanges.map((r) => [r.sprintId, r]));
  return pi.sprints.map((sprint) =>
    computeSprintCapacity(sprint, rangeMap.get(sprint.id), team, items)
  );
}

/**
 * Calculates total PTO days for a member across all their PTO spans.
 */
export function calculateTotalPtoDays(member: TeamMember): number {
  let total = 0;
  for (const span of member.ptoSpans) {
    const startDays = parseISODate(span.startDate);
    const endDays = parseISODate(span.endDate);
    if (endDays < startDays) continue;

    for (let d = startDays; d <= endDays; d++) {
      if (isWeekend(d)) continue;
      const deduction = getMemberPtoDeductionForDay([span], d);
      total += deduction;
    }
  }
  return Math.round(total * 10) / 10;
}
