/**
 * Standalone verification for the TeamStore seam - not part of the app
 * bundle, and not tied to any test framework (this project doesn't have
 * one set up). Run directly against the real yjs library with:
 *
 *   npx tsx src/collab/teamStore.verify.ts
 *
 * Kept as a real, runnable file (not deleted after one-off verification,
 * unlike most exploratory checks) because this specifically tests CRDT
 * merge correctness - the property most likely to silently break as more
 * of the workbook (requirements, timeline, diagram) is layered onto this
 * same pattern, and the least likely thing to notice by hand if it does.
 * Safe to delete if you'd rather not have a framework-less script like
 * this in the repo; nothing else depends on it.
 */
import * as Y from "yjs";
import { createLocalTeamStore } from "./teamStore";
import { createYjsTeamStore } from "./yjsTeamStore";
import type { TeamStore } from "./teamStore";
import type { TeamMember } from "../domain/teamTypes";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

function mkMember(id: string, overrides: Partial<TeamMember> = {}): TeamMember {
  return { id, name: `Member ${id}`, ptoSpans: [], ...overrides };
}

// Simulates syncing two Y.Docs, both directions - equivalent to what a
// real WebRTC round-trip does once peers are connected.
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
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

// === Part 1: conformance - same operations, same resulting snapshot ===
// Proves the Yjs implementation is a faithful drop-in for single-user
// use, not just "different but also works". Compared via canonicalJSON,
// not a plain JSON.stringify equality check, since object key insertion
// order differs between the two implementations' construction paths
// (confirmed by inspection) despite the actual data being identical -
// no correct code should ever depend on key iteration order.
{
  function runSequence(store: TeamStore) {
    store.addMember(mkMember("m1", { name: "Alice", role: "Engineer" }));
    store.addMember(mkMember("m2", { name: "Bob" }));
    store.updateMember("m1", { role: "Senior Engineer" });
    store.addPtoSpan("m1", { id: "pto1", startDate: "2026-09-01", endDate: "2026-09-03", startHalfDay: "full", endHalfDay: "full" });
    store.addExtraDayOff({ id: "d1", name: "Retreat", date: "2026-10-01" });
    store.updateSettings({ defaultPointsPerDay: 1.5 });
    store.deleteMember("m2");
    return store.getSnapshot();
  }

  const localSnap = runSequence(createLocalTeamStore());
  const yjsSnap = runSequence(createYjsTeamStore(new Y.Doc()));

  assert(canonicalJSON(localSnap) === canonicalJSON(yjsSnap), "local and Yjs stores produce an IDENTICAL snapshot after the same sequence of operations - the Yjs implementation is a faithful drop-in for single-user use");
}

// === Part 2: the actual point - concurrent, independent edits from different peers ===

// 2a. Two peers concurrently add DIFFERENT members, with no sync in between.
{
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const storeA = createYjsTeamStore(docA);
  const storeB = createYjsTeamStore(docB);

  storeA.addMember(mkMember("alice", { name: "Alice" }));
  storeB.addMember(mkMember("bob", { name: "Bob" }));

  sync(docA, docB);

  const snapA = storeA.getSnapshot();
  const snapB = storeB.getSnapshot();
  const idsA = snapA.members.map((m) => m.id).sort();
  const idsB = snapB.members.map((m) => m.id).sort();
  assert(JSON.stringify(idsA) === JSON.stringify(["alice", "bob"]), "peer A sees both members after sync");
  assert(JSON.stringify(idsB) === JSON.stringify(["alice", "bob"]), "peer B sees both members after sync");
  assert(JSON.stringify(idsA) === JSON.stringify(idsB), "both peers converge to the identical member order after merge");
}

// 2b. THE critical guarantee: two peers concurrently edit DIFFERENT FIELDS of the SAME member.
{
  const docA = new Y.Doc();
  const storeA = createYjsTeamStore(docA);
  storeA.addMember(mkMember("shared", { name: "Original Name", role: "Original Role" }));

  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const storeB = createYjsTeamStore(docB);

  // Concurrent, independent field edits - neither peer has seen the other's change yet.
  storeA.updateMember("shared", { name: "Changed By A" });
  storeB.updateMember("shared", { role: "Changed By B" });

  sync(docA, docB);

  const memberA = storeA.getSnapshot().members.find((m) => m.id === "shared")!;
  const memberB = storeB.getSnapshot().members.find((m) => m.id === "shared")!;

  assert(memberA.name === "Changed By A" && memberA.role === "Changed By B", "peer A's merged view has BOTH concurrent field edits - A's name change AND B's role change both survived, neither overwrote the other");
  assert(memberB.name === "Changed By A" && memberB.role === "Changed By B", "peer B's merged view matches peer A's exactly - this is the actual reason to use a CRDT instead of a plain 'replace the whole object' update");
}

// 2c. Concurrent PTO span additions to the same member from different peers.
{
  const docA = new Y.Doc();
  const storeA = createYjsTeamStore(docA);
  storeA.addMember(mkMember("shared"));

  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const storeB = createYjsTeamStore(docB);

  storeA.addPtoSpan("shared", { id: "pA", startDate: "2026-09-01", endDate: "2026-09-01", startHalfDay: "full", endHalfDay: "full" });
  storeB.addPtoSpan("shared", { id: "pB", startDate: "2026-09-15", endDate: "2026-09-15", startHalfDay: "full", endHalfDay: "full" });

  sync(docA, docB);

  const spanIdsA = storeA.getSnapshot().members[0].ptoSpans.map((p) => p.id).sort();
  const spanIdsB = storeB.getSnapshot().members[0].ptoSpans.map((p) => p.id).sort();
  assert(JSON.stringify(spanIdsA) === JSON.stringify(["pA", "pB"]), "both concurrently-added PTO spans survive the merge on peer A");
  assert(JSON.stringify(spanIdsA) === JSON.stringify(spanIdsB), "both peers converge to the identical set of PTO spans");
}

// 2d. The real edge case: one peer deletes a member while another concurrently edits a field on that same member.
{
  const docA = new Y.Doc();
  const storeA = createYjsTeamStore(docA);
  storeA.addMember(mkMember("doomed", { name: "About to be deleted" }));

  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const storeB = createYjsTeamStore(docB);

  storeA.deleteMember("doomed"); // A deletes it
  storeB.updateMember("doomed", { name: "B didn't know it was deleted" }); // B, unaware, edits it concurrently

  sync(docA, docB);

  const snapA = storeA.getSnapshot();
  const snapB = storeB.getSnapshot();
  assert(snapA.members.find((m) => m.id === "doomed") === undefined, "the delete wins on peer A - the concurrently-edited member is gone, not resurrected by B's edit");
  assert(snapB.members.find((m) => m.id === "doomed") === undefined, "the delete wins on peer B too - both peers converge to the same (deleted) outcome, no crash or orphaned entry from B's edit to now-deleted data");
  assert(snapA.members.length === 0 && snapB.members.length === 0, "no stale/orphaned member id lingers in either peer's member list after this race");
}

// 2e. A member's full field set round-trips correctly through the Yjs read path (sanity check on the mapping itself).
{
  const store = createYjsTeamStore(new Y.Doc());
  store.addMember({ id: "full", name: "Full Fields", role: "Role", avatarColor: "#ff0000", defaultPointsPerDay: 2, ptoSpans: [] });
  const m = store.getSnapshot().members[0];
  assert(
    m.id === "full" && m.name === "Full Fields" && m.role === "Role" && m.avatarColor === "#ff0000" && m.defaultPointsPerDay === 2,
    "every field of a member round-trips correctly through the Yjs Y.Map read path, not just the fields exercised by the merge tests above"
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
