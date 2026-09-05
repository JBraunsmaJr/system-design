import type { CapacityReservation } from "./programIncrements";

export type HalfDayType = "full" | "morning" | "afternoon";

export interface PtoSpan {
  id: string;
  startDate: string; // ISO format: YYYY-MM-DD
  endDate: string; // ISO format: YYYY-MM-DD
  /** Granularity: 'full' (1.0 day), 'morning' (first half, 0.5 day), 'afternoon' (second half, 0.5 day) */
  startHalfDay: HalfDayType;
  endHalfDay: HalfDayType;
  note?: string;
}

export interface ExtraDayOff {
  id: string;
  name: string;
  date: string; // ISO format: YYYY-MM-DD
  isHalfDay?: boolean; // false or undefined for full day (1.0), true for 0.5 day
  note?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role?: string;
  avatarColor?: string;
  /** Points per business day override (defaults to TeamSettings.defaultPointsPerDay, e.g. 1) */
  defaultPointsPerDay?: number;
  ptoSpans: PtoSpan[];
}

export interface TeamSettings {
  /** Default points per business day for members without an individual override (default 1) */
  defaultPointsPerDay: number;
  /** Whether to automatically exclude US Federal holidays from business day calculations (default true) */
  excludeUsHolidays: boolean;
  /** Custom/extra days off configured by the team (e.g. company retreats, extra holidays) */
  extraDaysOff: ExtraDayOff[];
}

export interface TeamDocument {
  members: TeamMember[];
  settings: TeamSettings;
}

export const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  defaultPointsPerDay: 1,
  excludeUsHolidays: true,
  extraDaysOff: [],
};

export const EMPTY_TEAM_DOCUMENT: TeamDocument = {
  members: [],
  settings: DEFAULT_TEAM_SETTINGS,
};

export interface MemberSprintCapacity {
  memberId: string;
  memberName: string;
  memberRole?: string;
  avatarColor?: string;
  pointsPerDay: number;
  /** Total business days in sprint (excluding holidays and extra days off) */
  sprintBusinessDays: number;
  /** PTO days taken by this member during this sprint (accounting for 1/2 days) */
  ptoDays: number;
  /** Effective available working days in the sprint */
  workingDays: number;
  /** Gross capacity points before reserve capacity deductions (workingDays * pointsPerDay) */
  grossCapacityPoints: number;
  /** Reserved capacity points for this member */
  reservedPoints: number;
  /** Net available capacity points for assignment (grossCapacityPoints - reservedPoints) */
  capacityPoints: number;
  /** Points assigned to this member in this sprint */
  assignedPoints: number;
  /** Available/remaining capacity points (capacityPoints - assignedPoints) */
  remainingPoints: number;
  /** Number of requirement items assigned to this member in this sprint */
  assignedItemCount: number;
}

export interface SprintCapacitySummary {
  sprintId: string;
  sprintName: string;
  startDate?: string;
  endDate?: string;
  durationDays: number;
  /** Business days in the sprint (Mon-Fri minus US holidays and extra days off) */
  sprintBusinessDays: number;
  /** Total gross team capacity in points across all members before reservations */
  grossCapacityPoints: number;
  /** Total reserved capacity in points across all applied reservations */
  totalReservedPoints: number;
  /** Total net available team capacity in points across all members (gross - reserved) */
  totalCapacityPoints: number;
  /** Total assigned points across all items in the sprint (assigned + unassigned) */
  totalAssignedPoints: number;
  /** Total unassigned item points in this sprint */
  unassignedPoints: number;
  /** Total available / remaining capacity for the team (totalCapacityPoints - totalAssignedPoints) */
  remainingCapacityPoints: number;
  /** Active capacity reservations applied to this sprint */
  appliedReservations: CapacityReservation[];
  /** Per-member capacity and assignment breakdown */
  memberBreakdown: MemberSprintCapacity[];
}
