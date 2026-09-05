/**
 * Standalone verification for the ProgramIncrementsStore seam - same
 * purpose and rationale as teamStore.verify.ts / requirementsStore.verify.ts.
 * Run with:
 *
 *   npx tsx src/collab/programIncrementsStore.verify.ts
 */
import * as Y from "yjs";
import { createLocalProgramIncrementsStore } from "./programIncrementsStore";
import { createYjsProgramIncrementsStore } from "./yjsProgramIncrementsStore";
import type { ProgramIncrementsStore } from "./programIncrementsStore";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

function forkPeer(sourceDoc: Y.Doc): { doc: Y.Doc; store: ProgramIncrementsStore } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(sourceDoc));
  return { doc, store: createYjsProgramIncrementsStore(doc) };
}

// === Part 1: conformance ===
{
  function runSequence(store: ProgramIncrementsStore) {
    const piId = store.addPI();
    store.updatePIName(piId, "Q1 2027");
    store.addSprint(piId);
    const sprintIds = store.getSnapshot().find((pi) => pi.id === piId)!.sprints.map((s) => s.id);
    store.updateSprintName(piId, sprintIds[0], "Sprint One");
    store.addReservation(piId, { name: "Risk Buffer", unit: "percentage", value: 15 });
    store.moveSprint(piId, sprintIds[1], "up");
    return store.getSnapshot();
  }

  const localSnap = runSequence(createLocalProgramIncrementsStore());
  const yjsSnap = runSequence(createYjsProgramIncrementsStore(new Y.Doc()));

  // Ids themselves are collision-resistant/random and will differ between
  // implementations by design - strip them before comparing structure.
  function stripIds(pis: ReturnType<ProgramIncrementsStore["getSnapshot"]>) {
    return pis.map((pi) => ({
      name: pi.name,
      startDate: pi.startDate,
      sprints: pi.sprints.map((s) => ({ name: s.name, durationDays: s.durationDays })),
      reservations: (pi.reservations ?? []).map((r) => ({ name: r.name, unit: r.unit, value: r.value })),
    }));
  }

  assert(
    canonicalJSON(stripIds(localSnap)) === canonicalJSON(stripIds(yjsSnap)),
    "local and Yjs stores produce structurally identical results (PI name, sprint names/order after the move, reservation) after the same sequence of operations - the Yjs implementation is a faithful drop-in for single-user use"
  );
}

// === Part 2: multi-peer CRDT scenarios ===

// 2a. Concurrent field edits on the SAME PI - name vs startDate.
{
  const peerA = { doc: new Y.Doc(), store: undefined as unknown as ProgramIncrementsStore };
  peerA.store = createYjsProgramIncrementsStore(peerA.doc);
  const piId = peerA.store.addPI();
  const peerB = forkPeer(peerA.doc);

  peerA.store.updatePIName(piId, "Renamed by A");
  peerB.store.updatePIStart(piId, "2027-06-01");

  sync(peerA.doc, peerB.doc);

  const piA = peerA.store.getSnapshot().find((pi) => pi.id === piId)!;
  const piB = peerB.store.getSnapshot().find((pi) => pi.id === piId)!;
  assert(piA.name === "Renamed by A" && piA.startDate === "2027-06-01", "peer A's merged view has BOTH concurrent field edits on the same PI - A's name change and B's startDate change both survived");
  assert(piB.name === "Renamed by A" && piB.startDate === "2027-06-01", "peer B's merged view matches peer A's exactly");
}

// 2b. Concurrent field edits on the SAME sprint - name vs duration (via updateSprintEnd).
{
  const docA = new Y.Doc();
  const storeA = createYjsProgramIncrementsStore(docA);
  const piId = storeA.addPI();
  const sprintId = storeA.getSnapshot()[0].sprints[0].id;
  const peerB = forkPeer(docA);

  storeA.updateSprintName(piId, sprintId, "Renamed Sprint");
  const startDate = peerB.store.getSnapshot()[0].startDate;
  // Extend the sprint's end date - the default duration is 14 days
  // starting at startDate, so pushing the end out further increases
  // durationDays.
  const [y, m, d] = startDate.split("-").map(Number);
  const laterDate = new Date(Date.UTC(y, m - 1, d + 20)).toISOString().slice(0, 10);
  peerB.store.updateSprintEnd(piId, sprintId, laterDate);

  sync(docA, peerB.doc);

  const sprintA = storeA.getSnapshot()[0].sprints[0];
  const sprintB = peerB.store.getSnapshot()[0].sprints[0];
  assert(sprintA.name === "Renamed Sprint" && sprintA.durationDays > 14, "peer A's merged view has BOTH concurrent field edits on the same sprint - the name change and the extended duration both survived");
  assert(sprintB.name === "Renamed Sprint" && sprintB.durationDays === sprintA.durationDays, "peer B's merged view matches peer A's exactly");
}

// 2c. Concurrent addition of different sprints to the same PI converges.
{
  const docA = new Y.Doc();
  const storeA = createYjsProgramIncrementsStore(docA);
  const piId = storeA.addPI();
  const peerB = forkPeer(docA);

  storeA.addSprint(piId); // now 2 sprints on A's side
  peerB.store.addSprint(piId); // now 2 sprints on B's side, independently

  sync(docA, peerB.doc);

  const sprintsA = storeA.getSnapshot()[0].sprints;
  const sprintsB = peerB.store.getSnapshot()[0].sprints;
  assert(sprintsA.length === 3, "all three sprints (the original plus both concurrently-added ones) survive on peer A");
  assert(JSON.stringify(sprintsA.map((s) => s.id).sort()) === JSON.stringify(sprintsB.map((s) => s.id).sort()), "both peers converge to the identical set of sprints");
}

// 2d. Delete-vs-edit race on a PI.
{
  const docA = new Y.Doc();
  const storeA = createYjsProgramIncrementsStore(docA);
  const piId = storeA.addPI();
  const peerB = forkPeer(docA);

  storeA.deletePI(piId);
  peerB.store.updatePIName(piId, "B didn't know it was deleted");

  sync(docA, peerB.doc);

  assert(storeA.getSnapshot().find((pi) => pi.id === piId) === undefined, "the delete wins on peer A - not resurrected by B's concurrent edit");
  assert(peerB.store.getSnapshot().find((pi) => pi.id === piId) === undefined, "the delete wins on peer B too - both converge to the same outcome");
}

// 2e. Concurrent reservation add + delete on the same PI converge without conflict.
{
  const docA = new Y.Doc();
  const storeA = createYjsProgramIncrementsStore(docA);
  const piId = storeA.addPI();
  storeA.addReservation(piId, { name: "Existing Reservation", unit: "percentage", value: 10 });
  const existingId = storeA.getSnapshot()[0].reservations![0].id;
  const peerB = forkPeer(docA);

  storeA.addReservation(piId, { name: "Added by A", unit: "points", value: 5 });
  peerB.store.deleteReservation(piId, existingId);

  sync(docA, peerB.doc);

  const reservationsA = storeA.getSnapshot()[0].reservations ?? [];
  const reservationsB = peerB.store.getSnapshot()[0].reservations ?? [];
  assert(reservationsA.length === 1 && reservationsA[0].name === "Added by A", "peer A's merged view has the deletion AND the addition both applied - the pre-existing reservation is gone, the new one from A survived");
  assert(JSON.stringify(reservationsA.map((r) => r.id).sort()) === JSON.stringify(reservationsB.map((r) => r.id).sort()), "both peers converge to the identical set of reservations");
}

// === Part 3: moveSprint's Y.Array swap logic, standalone ===
{
  const doc = new Y.Doc();
  const store = createYjsProgramIncrementsStore(doc);
  const piId = store.addPI();
  store.addSprint(piId);
  store.addSprint(piId); // 3 sprints total: [S1, S2, S3] (ids[0], ids[1], ids[2])
  const ids = store.getSnapshot()[0].sprints.map((s) => s.id);

  store.moveSprint(piId, ids[1], "up"); // S2 (index 1) swaps with S1 (index 0) -> [S2, S1, S3]
  let order = store.getSnapshot()[0].sprints.map((s) => s.id);
  assert(JSON.stringify(order) === JSON.stringify([ids[1], ids[0], ids[2]]), "moving the middle sprint up swaps it with the first, matching manual trace before implementation");

  // S2 is now at index 0 (per the result just above) - moving it "down"
  // swaps it with whatever's now at index 1, which is S1.
  store.moveSprint(piId, ids[1], "down");
  order = store.getSnapshot()[0].sprints.map((s) => s.id);
  assert(JSON.stringify(order) === JSON.stringify([ids[0], ids[1], ids[2]]), "moving that same sprint back down swaps it with S1 again (its CURRENT neighbor at index 1, not wherever it started) - correctly restoring the original order");

  // Order is now back to [S1, S2, S3] - S1 is genuinely at index 0, so
  // moving IT up is the actual no-op case.
  const beforeInvalid = store.getSnapshot()[0].sprints.map((s) => s.id);
  store.moveSprint(piId, ids[0], "up");
  const afterInvalid = store.getSnapshot()[0].sprints.map((s) => s.id);
  assert(JSON.stringify(beforeInvalid) === JSON.stringify(afterInvalid), "moving the sprint actually at the first position further up is a safe no-op, not an error or corruption");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
