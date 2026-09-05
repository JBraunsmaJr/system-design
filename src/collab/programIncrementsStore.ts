import type { ProgramIncrement, CapacityReservation } from "../domain/programIncrements";
import { updateSprintEndDate, updatePIStartDate } from "../domain/programIncrements";

/**
 * ProgramIncrementsStore is the same kind of seam TeamStore and
 * RequirementsStore are (see teamStore.ts for the fuller rationale) - a
 * narrow, named-operation contract so a local implementation (this file)
 * and a collaborative, Yjs-backed one (yjsProgramIncrementsStore.ts) can
 * be swapped behind it without any consuming code needing to change.
 *
 * Unlike TeamDocument/RequirementsDocument, the top-level shape here is
 * a plain array (ProgramIncrement[]), not a wrapper object - getSnapshot
 * reflects that directly.
 *
 * The operations were derived by reading every onUpdateProgramIncrements
 * call site across TimelineView.tsx and TeamView.tsx (11 in total,
 * including the shared ManageReservationsModal both views render), the
 * same discipline as the other two stores.
 *
 * This is the most deeply nested of the three domains so far: a PI
 * contains both an array of sprints AND an array of reservations, each
 * needing their own id-keyed structure. PI name/startDate and sprint
 * name/durationDays each have their own independent single-field patch
 * operation today (updatePIName vs updatePIStart; updateSprintName vs
 * updateSprintEnd) - the same "field-level patch operation exists"
 * signal that meant items and members needed nested Y.Maps rather than
 * plain values. Reservations don't: their one edit path
 * (ManageReservationsModal's save handler) always replaces every field
 * together, never just one - so, matching the same reasoning already
 * applied to team's extraDaysOff and requirements' categories, they stay
 * plain values in the Yjs implementation. See
 * yjsProgramIncrementsStore.ts's own doc comment for the full schema.
 *
 * One thing worth being explicit about, unlike requirements' item ids:
 * PI and sprint ids are purely internal (used only as React keys -
 * confirmed by checking every render site - never displayed to the
 * user, never referenced via markdown-style syntax the way requirement
 * item ids are). That means the Yjs implementation can generate them
 * with a fully collision-resistant scheme from the start, with no
 * visible-format trade-off and no need for anything like requirements'
 * id-collision repair pass.
 */
export interface ProgramIncrementsStore {
  getSnapshot(): ProgramIncrement[];
  subscribe(listener: () => void): () => void;

  /** Creates a new PI with a single default first sprint and returns its
   * id. */
  addPI(): string;
  updatePIName(piId: string, name: string): void;
  updatePIStart(piId: string, startDate: string): void;
  deletePI(piId: string): void;

  addSprint(piId: string): void;
  updateSprintName(piId: string, sprintId: string, name: string): void;
  /** Reuses the same updateSprintEndDate pure helper the app already
   * uses - converts the given end date into a new duration for this
   * sprint, silently no-op-ing on an invalid (zero or negative
   * duration) result, same as today. */
  updateSprintEnd(piId: string, sprintId: string, newEndDate: string): void;
  deleteSprint(piId: string, sprintId: string): void;
  moveSprint(piId: string, sprintId: string, direction: "up" | "down"): void;

  addReservation(piId: string, reservation: Omit<CapacityReservation, "id">): void;
  updateReservation(piId: string, reservationId: string, patch: Omit<CapacityReservation, "id">): void;
  deleteReservation(piId: string, reservationId: string): void;
}

const DEFAULT_SPRINT_DURATION_DAYS = 14;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createLocalProgramIncrementsStore(initial: ProgramIncrement[] = []): ProgramIncrementsStore {
  let pis: ProgramIncrement[] = initial;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => pis,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addPI: () => {
      const newPI: ProgramIncrement = {
        id: nextId("pi"),
        name: `PI ${pis.length + 1}`,
        startDate: todayISO(),
        sprints: [{ id: nextId("sprint"), name: "Sprint 1", durationDays: DEFAULT_SPRINT_DURATION_DAYS }],
      };
      pis = [...pis, newPI];
      notify();
      return newPI.id;
    },

    updatePIName: (piId, name) => {
      pis = pis.map((pi) => (pi.id === piId ? { ...pi, name } : pi));
      notify();
    },

    updatePIStart: (piId, startDate) => {
      pis = pis.map((pi) => (pi.id === piId ? updatePIStartDate(pi, startDate) : pi));
      notify();
    },

    deletePI: (piId) => {
      pis = pis.filter((pi) => pi.id !== piId);
      notify();
    },

    addSprint: (piId) => {
      pis = pis.map((pi) =>
        pi.id === piId
          ? {
              ...pi,
              sprints: [
                ...pi.sprints,
                { id: nextId("sprint"), name: `Sprint ${pi.sprints.length + 1}`, durationDays: DEFAULT_SPRINT_DURATION_DAYS },
              ],
            }
          : pi
      );
      notify();
    },

    updateSprintName: (piId, sprintId, name) => {
      pis = pis.map((pi) =>
        pi.id === piId ? { ...pi, sprints: pi.sprints.map((s) => (s.id === sprintId ? { ...s, name } : s)) } : pi
      );
      notify();
    },

    updateSprintEnd: (piId, sprintId, newEndDate) => {
      pis = pis.map((pi) => (pi.id === piId ? updateSprintEndDate(pi, sprintId, newEndDate) : pi));
      notify();
    },

    deleteSprint: (piId, sprintId) => {
      pis = pis.map((pi) => (pi.id === piId ? { ...pi, sprints: pi.sprints.filter((s) => s.id !== sprintId) } : pi));
      notify();
    },

    moveSprint: (piId, sprintId, direction) => {
      pis = pis.map((pi) => {
        if (pi.id !== piId) return pi;
        const index = pi.sprints.findIndex((s) => s.id === sprintId);
        const swapWith = direction === "up" ? index - 1 : index + 1;
        if (index === -1 || swapWith < 0 || swapWith >= pi.sprints.length) return pi;
        const sprints = [...pi.sprints];
        [sprints[index], sprints[swapWith]] = [sprints[swapWith], sprints[index]];
        return { ...pi, sprints };
      });
      notify();
    },

    addReservation: (piId, reservation) => {
      const newReservation: CapacityReservation = { ...reservation, id: nextId("cres") };
      pis = pis.map((pi) =>
        pi.id === piId ? { ...pi, reservations: [...(pi.reservations ?? []), newReservation] } : pi
      );
      notify();
    },

    updateReservation: (piId, reservationId, patch) => {
      pis = pis.map((pi) =>
        pi.id === piId
          ? {
              ...pi,
              reservations: (pi.reservations ?? []).map((r) => (r.id === reservationId ? { ...patch, id: r.id } : r)),
            }
          : pi
      );
      notify();
    },

    deleteReservation: (piId, reservationId) => {
      pis = pis.map((pi) =>
        pi.id === piId ? { ...pi, reservations: (pi.reservations ?? []).filter((r) => r.id !== reservationId) } : pi
      );
      notify();
    },
  };
}
