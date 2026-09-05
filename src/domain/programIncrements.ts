export type CapacityReservationUnit = "percentage" | "points";

export interface CapacityReservation {
  id: string;
  name: string;
  unit: CapacityReservationUnit;
  /** Value of the reservation (e.g. 20 for 20%, or 5 for 5 points) */
  value: number;
  /** If undefined, null, or empty string, this applies to ALL sprints in the PI.
   * If set to a specific sprintId, applies ONLY to that sprint. */
  sprintId?: string;
  category?: "risk" | "bugs" | "techdebt" | "meetings" | "other" | string;
  note?: string;
}

export interface Sprint {
  id: string;
  name: string;
  /** Length of this sprint in days, inclusive of both its start and end
   * day - e.g. 14 for two full weeks. This is the only thing ever stored
   * for a sprint's timing; its actual start/end dates are always
   * computed (see computeSprintDateRanges), never stored independently. */
  durationDays: number;
}

export interface ProgramIncrement {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) - the only directly-stored date in the whole
   * PI. Every sprint's actual start/end is derived from this plus the
   * cumulative durations of the sprints before it. This is what makes
   * "extend sprint 1, sprint 2 onward shifts automatically" free rather
   * than something that needs explicit cascade-update logic to keep in
   * sync - there's nothing stored to fall out of sync in the first
   * place. Verified this cascading behavior - including shortening,
   * editing a non-first sprint, and crossing month/year boundaries -
   * with a standalone test suite before writing this file. */
  startDate: string;
  sprints: Sprint[];
  /** Optional capacity reservations (risk buffer, tech debt, bugs, meetings, etc.)
   * defined for this PI. Can apply PI-wide to all sprints, or to specific sprints. */
  reservations?: CapacityReservation[];
}

export interface SprintDateRange {
  sprintId: string;
  startDate: string;
  endDate: string;
}

/** Converts a YYYY-MM-DD string to a day count (days since the Unix
 * epoch, UTC-based). All date arithmetic in this module works on these
 * plain integers rather than JS Date objects directly, specifically to
 * avoid local-timezone drift - a UTC-based day count is unambiguous
 * regardless of what timezone the browser or server happens to be in. */
function parseISODate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

function formatISODate(days: number): string {
  const d = new Date(days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Computes every sprint's actual start/end date by walking the sequence
 * once: the first sprint starts at the PI's own startDate, and each
 * subsequent sprint starts the day immediately after the previous one
 * ends - sprints are always contiguous by construction, there's no way
 * to represent a gap or overlap in this model. */
export function computeSprintDateRanges(pi: ProgramIncrement): SprintDateRange[] {
  const ranges: SprintDateRange[] = [];
  let cursor = parseISODate(pi.startDate);
  for (const sprint of pi.sprints) {
    const start = cursor;
    const end = start + sprint.durationDays - 1;
    ranges.push({ sprintId: sprint.id, startDate: formatISODate(start), endDate: formatISODate(end) });
    cursor = end + 1;
  }
  return ranges;
}

function daysBetweenInclusive(startIso: string, endIso: string): number {
  return parseISODate(endIso) - parseISODate(startIso) + 1;
}

/**
 * Updates a single sprint's end date, converting it to a new duration for
 * that sprint - everything after it in the sequence shifts automatically
 * the next time computeSprintDateRanges is called, since their dates were
 * never stored independently. Sprints before the edited one are
 * completely unaffected, since each sprint's start only ever depends on
 * what comes before it, not after.
 *
 * Silently rejects (returns `pi` unchanged) an end date that would make
 * the sprint's own duration zero or negative, and a request to update a
 * sprint id that doesn't exist in this PI - both are safe no-ops rather
 * than throwing, since this is typically called directly from a date
 * picker's onChange where invalid intermediate values are routine.
 */
export function updateSprintEndDate(pi: ProgramIncrement, sprintId: string, newEndDate: string): ProgramIncrement {
  const ranges = computeSprintDateRanges(pi);
  const currentRange = ranges.find((r) => r.sprintId === sprintId);
  if (!currentRange) return pi;
  const newDuration = daysBetweenInclusive(currentRange.startDate, newEndDate);
  if (newDuration < 1) return pi;
  return { ...pi, sprints: pi.sprints.map((s) => (s.id === sprintId ? { ...s, durationDays: newDuration } : s)) };
}

/**
 * Filters all capacity reservations applicable to a specific sprint in a PI.
 * Returns reservations that are PI-wide (no sprintId specified) or specifically assigned to this sprintId.
 */
export function getSprintActiveReservations(
  reservations: CapacityReservation[] | undefined,
  sprintId: string
): CapacityReservation[] {
  if (!reservations || !Array.isArray(reservations)) return [];
  return reservations.filter((r) => !r.sprintId || r.sprintId.trim() === "" || r.sprintId === sprintId);
}

/** Updates the PI's own overall start date - shifts every sprint's
 * computed dates uniformly, same reasoning as updateSprintEndDate: there's
 * nothing per-sprint to explicitly re-cascade, since nothing per-sprint
 * was storing an absolute date to begin with. */
export function updatePIStartDate(pi: ProgramIncrement, newStartDate: string): ProgramIncrement {
  return { ...pi, startDate: newStartDate };
}
