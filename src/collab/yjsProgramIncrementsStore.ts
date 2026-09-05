import * as Y from "yjs";
import type { ProgramIncrement, Sprint, CapacityReservation } from "../domain/programIncrements";
import { updateSprintEndDate } from "../domain/programIncrements";
import type { ProgramIncrementsStore } from "./programIncrementsStore";

const DEFAULT_SPRINT_DURATION_DAYS = 14;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** PI and sprint ids are purely internal (never displayed - see
 * programIncrementsStore.ts's doc comment), so there's no reason not to
 * make them fully collision-resistant from the start, the same
 * timestamp+random scheme relationships already use - unlike
 * requirements' item ids, there's no human-readable format to preserve
 * here, so this sidesteps that whole problem class entirely rather than
 * needing a repair pass. */
function collisionResistantId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Yjs-backed ProgramIncrementsStore. See programIncrementsStore.ts for
 * why the operations are shaped the way they are; this file is about
 * the schema that makes them merge correctly.
 *
 * Schema (all on the given Y.Doc):
 *  - "piOrder": Y.Array<string> - PI ids, in display order.
 *  - "pis": Y.Map<string, Y.Map> - keyed by PI id. Each value is a
 *    nested Y.Map (name, startDate patch independently via
 *    updatePIName/updatePIStart - the same "separate single-field patch
 *    operations exist" signal that means members and items needed
 *    nesting) holding THREE further keys:
 *      - "sprintOrder": Y.Array<string>, sprint ids in order within
 *        this PI.
 *      - "sprints": Y.Map<string, Y.Map> - keyed by sprint id, each a
 *        further-nested Y.Map (name, durationDays - same reasoning,
 *        updateSprintName and updateSprintEnd are separate operations).
 *      - "reservations": Y.Map<string, CapacityReservation> - keyed by
 *        reservation id, PLAIN values. Unlike sprints/PIs, no operation
 *        ever patches a single field of an existing reservation -
 *        ManageReservationsModal's save handler always replaces every
 *        field together - so this follows the same "plain value, no
 *        nesting" pattern already used for team's extraDaysOff and
 *        requirements' categories/relationshipTypes.
 */
export function createYjsProgramIncrementsStore(doc: Y.Doc): ProgramIncrementsStore {
  const piOrder = doc.getArray<string>("piOrder");
  const pis = doc.getMap<Y.Map<unknown>>("pis");

  function sprintMapToPlain(id: string, m: Y.Map<unknown>): Sprint {
    return { id, name: m.get("name") as string, durationDays: m.get("durationDays") as number };
  }

  function piMapToPlain(id: string, m: Y.Map<unknown>): ProgramIncrement {
    const sprintOrder = m.get("sprintOrder") as Y.Array<string>;
    const sprints = m.get("sprints") as Y.Map<Y.Map<unknown>>;
    const reservations = m.get("reservations") as Y.Map<CapacityReservation>;
    return {
      id,
      name: m.get("name") as string,
      startDate: m.get("startDate") as string,
      sprints: sprintOrder
        .toArray()
        .map((sid) => {
          const sm = sprints.get(sid);
          return sm ? sprintMapToPlain(sid, sm) : null;
        })
        .filter((s): s is Sprint => s !== null),
      reservations: reservations.size > 0 ? Array.from(reservations.values()) : undefined,
    };
  }

  function buildSnapshot(): ProgramIncrement[] {
    return piOrder
      .toArray()
      .map((id) => {
        const m = pis.get(id);
        return m ? piMapToPlain(id, m) : null;
      })
      .filter((pi): pi is ProgramIncrement => pi !== null);
  }

  let cached = buildSnapshot();
  const listeners = new Set<() => void>();
  const recomputeAndNotify = () => {
    cached = buildSnapshot();
    for (const listener of listeners) listener();
  };

  piOrder.observeDeep(recomputeAndNotify);
  pis.observeDeep(recomputeAndNotify);

  function getPIMap(piId: string): Y.Map<unknown> | undefined {
    return pis.get(piId);
  }

  return {
    getSnapshot: () => cached,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addPI: () => {
      const piId = collisionResistantId("pi");
      const sprintId = collisionResistantId("sprint");
      doc.transact(() => {
        const sprintM = new Y.Map<unknown>();
        sprintM.set("name", "Sprint 1");
        sprintM.set("durationDays", DEFAULT_SPRINT_DURATION_DAYS);
        const sprintsMap = new Y.Map<Y.Map<unknown>>();
        sprintsMap.set(sprintId, sprintM);
        const sprintOrderArr = new Y.Array<string>();
        sprintOrderArr.push([sprintId]);

        const piM = new Y.Map<unknown>();
        piM.set("name", `PI ${piOrder.length + 1}`);
        piM.set("startDate", todayISO());
        piM.set("sprintOrder", sprintOrderArr);
        piM.set("sprints", sprintsMap);
        piM.set("reservations", new Y.Map<CapacityReservation>());

        pis.set(piId, piM);
        piOrder.push([piId]);
      });
      return piId;
    },

    updatePIName: (piId, name) => {
      const m = getPIMap(piId);
      if (m) m.set("name", name);
    },

    updatePIStart: (piId, startDate) => {
      const m = getPIMap(piId);
      if (m) m.set("startDate", startDate);
    },

    deletePI: (piId) => {
      doc.transact(() => {
        pis.delete(piId);
        const idx = piOrder.toArray().indexOf(piId);
        if (idx !== -1) piOrder.delete(idx, 1);
      });
    },

    addSprint: (piId) => {
      const m = getPIMap(piId);
      if (!m) return;
      const sprintOrder = m.get("sprintOrder") as Y.Array<string>;
      const sprints = m.get("sprints") as Y.Map<Y.Map<unknown>>;
      const sprintId = collisionResistantId("sprint");
      doc.transact(() => {
        const sprintM = new Y.Map<unknown>();
        sprintM.set("name", `Sprint ${sprintOrder.length + 1}`);
        sprintM.set("durationDays", DEFAULT_SPRINT_DURATION_DAYS);
        sprints.set(sprintId, sprintM);
        sprintOrder.push([sprintId]);
      });
    },

    updateSprintName: (piId, sprintId, name) => {
      const piM = getPIMap(piId);
      const sprints = piM?.get("sprints") as Y.Map<Y.Map<unknown>> | undefined;
      const sprintM = sprints?.get(sprintId);
      if (sprintM) sprintM.set("name", name);
    },

    // Reuses the exact same pure helper the local store and the rest of
    // the app already use - it works against a plain ProgramIncrement,
    // so this reads the current one out of `cached`, computes the
    // result, then writes just the one changed sprint's new duration
    // back to the actual nested map, rather than replacing the whole PI
    // (which would discard field-level merge protection for anything
    // else concurrently changing on this PI).
    updateSprintEnd: (piId, sprintId, newEndDate) => {
      const currentPI = cached.find((pi) => pi.id === piId);
      if (!currentPI) return;
      const updated = updateSprintEndDate(currentPI, sprintId, newEndDate);
      const updatedSprint = updated.sprints.find((s) => s.id === sprintId);
      if (!updatedSprint) return;
      const piM = getPIMap(piId);
      const sprints = piM?.get("sprints") as Y.Map<Y.Map<unknown>> | undefined;
      const sprintM = sprints?.get(sprintId);
      if (sprintM) sprintM.set("durationDays", updatedSprint.durationDays);
    },

    deleteSprint: (piId, sprintId) => {
      const piM = getPIMap(piId);
      if (!piM) return;
      const sprintOrder = piM.get("sprintOrder") as Y.Array<string>;
      const sprints = piM.get("sprints") as Y.Map<Y.Map<unknown>>;
      doc.transact(() => {
        sprints.delete(sprintId);
        const idx = sprintOrder.toArray().indexOf(sprintId);
        if (idx !== -1) sprintOrder.delete(idx, 1);
      });
    },

    moveSprint: (piId, sprintId, direction) => {
      const piM = getPIMap(piId);
      if (!piM) return;
      const sprintOrder = piM.get("sprintOrder") as Y.Array<string>;
      const arr = sprintOrder.toArray();
      const index = arr.indexOf(sprintId);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= arr.length) return;
      doc.transact(() => {
        // Y.Array has no in-place swap - remove both affected entries
        // and reinsert them in the swapped order. Removing the
        // higher-indexed one first keeps the lower index valid for the
        // second removal.
        const [lo, hi] = index < swapWith ? [index, swapWith] : [swapWith, index];
        const hiId = arr[hi];
        const loId = arr[lo];
        sprintOrder.delete(hi, 1);
        sprintOrder.delete(lo, 1);
        sprintOrder.insert(lo, [hiId, loId]);
      });
    },

    addReservation: (piId, reservation) => {
      const piM = getPIMap(piId);
      if (!piM) return;
      const reservations = piM.get("reservations") as Y.Map<CapacityReservation>;
      const id = collisionResistantId("cres");
      reservations.set(id, { ...reservation, id });
    },

    updateReservation: (piId, reservationId, patch) => {
      const piM = getPIMap(piId);
      if (!piM) return;
      const reservations = piM.get("reservations") as Y.Map<CapacityReservation>;
      if (!reservations.has(reservationId)) return;
      reservations.set(reservationId, { ...patch, id: reservationId });
    },

    deleteReservation: (piId, reservationId) => {
      const piM = getPIMap(piId);
      if (!piM) return;
      const reservations = piM.get("reservations") as Y.Map<CapacityReservation>;
      reservations.delete(reservationId);
    },
  };
}
