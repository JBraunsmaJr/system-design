/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/collab/milestonesStore.verify.ts
 */
import * as Y from "yjs";
import { createLocalMilestonesStore } from "./milestonesStore";
import { createYjsMilestonesStore, seedYjsMilestonesDoc } from "./yjsMilestonesStore";
import type { Milestone } from "../domain/milestones";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// === Part 1: Local Milestones Store CRUD ===
{
  const store = createLocalMilestonesStore();
  let notifications = 0;
  store.subscribe(() => notifications++);

  const mId = store.addMilestone({
    type: "release",
    name: "Release 1.0",
    scheduledAt: "2026-09-30",
    version: "1.0.0",
    description: "Initial production release",
  });

  assert(notifications === 1, "subscribers notified on addMilestone");
  let list = store.getSnapshot();
  assert(list.length === 1 && list[0].id === mId, "milestone is added and returned in snapshot");
  assert(list[0].name === "Release 1.0" && list[0].type === "release", "fields are correctly populated");

  // Update milestone (AC-004, AC-010: stable identity when name/version changed)
  store.updateMilestone(mId, { name: "Release 2.0", version: "2.0.0" });
  assert(notifications === 2, "subscribers notified on updateMilestone");
  list = store.getSnapshot();
  assert(list[0].id === mId, "stable identity preserved across update (AC-010, FR-011)");
  assert(list[0].name === "Release 2.0" && list[0].version === "2.0.0", "updated values reflected");

  // Related work items (FR-007, AC-007)
  store.addRelatedWorkableItem(mId, "TICKET-1");
  store.addRelatedWorkableItem(mId, "TICKET-2");
  store.addRelatedWorkableItem(mId, "TICKET-1"); // duplicate should be ignored
  list = store.getSnapshot();
  assert(
    list[0].relatedWorkableItemIds?.length === 2 &&
      list[0].relatedWorkableItemIds.includes("TICKET-1") &&
      list[0].relatedWorkableItemIds.includes("TICKET-2"),
    "related workable items added without duplicates"
  );

  store.removeRelatedWorkableItem(mId, "TICKET-1");
  list = store.getSnapshot();
  assert(
    list[0].relatedWorkableItemIds?.length === 1 && list[0].relatedWorkableItemIds[0] === "TICKET-2",
    "removeRelatedWorkableItem removes item"
  );

  store.setRelatedWorkableItems(mId, ["TICKET-3", "TICKET-4"]);
  list = store.getSnapshot();
  assert(
    list[0].relatedWorkableItemIds?.length === 2 &&
      list[0].relatedWorkableItemIds[0] === "TICKET-3" &&
      list[0].relatedWorkableItemIds[1] === "TICKET-4",
    "setRelatedWorkableItems replaces related list"
  );

  // Deletion (AC-005)
  store.deleteMilestone(mId);
  assert(store.getSnapshot().length === 0, "milestone deleted from store");
}

// === Part 2: Multiple Releases on Same Date (AC-009, FR-003) ===
{
  const store = createLocalMilestonesStore();
  const id1 = store.addMilestone({ type: "release", name: "Release 2.4", scheduledAt: "2026-09-30" });
  const id2 = store.addMilestone({ type: "release", name: "Release 2.4.1", scheduledAt: "2026-09-30" });
  const id3 = store.addMilestone({ type: "release", name: "Mobile Release", scheduledAt: "2026-09-30" });

  const list = store.getSnapshot();
  assert(list.length === 3 && id1 !== id2 && id2 !== id3, "multiple releases on same date coexist with distinct ids");
  assert(
    list.every((m) => m.scheduledAt === "2026-09-30"),
    "all releases retain their scheduled date"
  );
}

// === Part 3: Yjs Collaborative Milestones Store ===
{
  const docA = new Y.Doc();
  const storeA = createYjsMilestonesStore(docA);

  const initial: Milestone[] = [
    {
      id: "seed-1",
      type: "release",
      name: "Release Alpha",
      scheduledAt: "2026-10-15",
      version: "0.9.0",
      relatedWorkableItemIds: ["TICKET-10"],
    },
  ];

  seedYjsMilestonesDoc(docA, initial);
  assert(storeA.getSnapshot().length === 1, "seed populates Yjs doc correctly");
  assert(storeA.getSnapshot()[0].id === "seed-1", "seeded id preserved");
  assert(storeA.getSnapshot()[0].name === "Release Alpha", "seeded name preserved");
  assert(storeA.getSnapshot()[0].relatedWorkableItemIds?.[0] === "TICKET-10", "seeded workable items preserved");

  // Sync docA with docB (simulating remote peer)
  const docB = new Y.Doc();
  const storeB = createYjsMilestonesStore(docB);

  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  assert(storeB.getSnapshot().length === 1, "docB receives initial sync");
  assert(storeB.getSnapshot()[0].name === "Release Alpha", "docB has correct snapshot");

  // Peer A updates name, Peer B adds related item concurrently
  storeA.updateMilestone("seed-1", { name: "Release Beta", version: "0.9.5" });
  storeB.addRelatedWorkableItem("seed-1", "TICKET-20");

  // Sync both ways
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

  const finalA = storeA.getSnapshot()[0];
  const finalB = storeB.getSnapshot()[0];

  assert(finalA.name === "Release Beta", "peer A retains updated name after sync");
  assert(finalB.name === "Release Beta", "peer B receives updated name");
  assert(
    Boolean(finalA.relatedWorkableItemIds?.includes("TICKET-20") && finalB.relatedWorkableItemIds?.includes("TICKET-20")),
    "both peers have merged related workable items"
  );

  // Peer A and Peer B concurrently add the exact same related item
  storeA.addRelatedItem("seed-1", "TICKET-30");
  storeB.addRelatedItem("seed-1", "TICKET-30");

  // Sync both ways
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

  const mergedA = storeA.getSnapshot()[0];
  const mergedB = storeB.getSnapshot()[0];

  const countInA = mergedA.relatedItemIds?.filter((id) => id === "TICKET-30").length ?? 0;
  const countInB = mergedB.relatedItemIds?.filter((id) => id === "TICKET-30").length ?? 0;

  assert(countInA === 1, "peer A snapshot deduplicates concurrent addRelatedItem result");
  assert(countInB === 1, "peer B snapshot deduplicates concurrent addRelatedItem result");
  assert(
    mergedA.relatedItemIds?.length === 3 && mergedB.relatedItemIds?.length === 3,
    "set semantics observed across concurrent additions"
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
