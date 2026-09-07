/**
 * Standalone verification for the RequirementsStore seam - same purpose
 * and rationale as teamStore.verify.ts. Run with:
 *
 *   npx tsx src/collab/requirementsStore.verify.ts
 */
import * as Y from "yjs";
import { createLocalRequirementsStore, createAdapterRequirementsStore } from "./requirementsStore";
import { createYjsRequirementsStore, seedYjsRequirementsDoc, seedBuiltInTypesIfEmpty } from "./yjsRequirementsStore";
import type { RequirementsStore } from "./requirementsStore";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "../domain/requirementsTypes";
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from "../domain/requirementsRegistry";

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

// A doc with the built-in item/relationship types already populated -
// every real document starts from this, not an empty one, and addItem
// needs at least one real type (with a real prefix) to generate
// meaningful ids against.
function seedDoc() {
  return { ...EMPTY_REQUIREMENTS_DOCUMENT, itemTypes: BUILT_IN_ITEM_TYPES, relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES };
}

function seedYjsStore(): { doc: Y.Doc; store: RequirementsStore } {
  const doc = new Y.Doc();
  seedBuiltInTypesIfEmpty(doc);
  const store = createYjsRequirementsStore(doc);
  return { doc, store };
}

// === Part 1: conformance ===
{
  function runSequence(store: RequirementsStore) {
    const id1 = store.addItem("requirement");
    const id2 = store.addItem("requirement");
    store.updateItem(id1, { title: "First", body: "Body text" });
    store.createAndAssignCategory(id1, "Auth");
    const relError = store.addRelationship("blocks", id1, id2);
    store.deleteItem(id2);
    // Both deletion paths are exercised here so all three
    // implementations have to agree on them, not just on the operations
    // that existed before: a category deleted while an item still uses
    // it, and a type deletion refused because an item still uses it.
    store.createAndAssignCategory(id1, "Doomed");
    const doomed = store.getSnapshot().categories.find((c) => c.label === "Doomed")!;
    store.deleteCategory(doomed.id);
    store.addCustomType("Widget", "WID", "#5b7cfa", true);
    const widgetItem = store.addItem("custom-1");
    const refusedDelete = store.deleteCustomType("custom-1");
    store.deleteItem(widgetItem);
    const allowedDelete = store.deleteCustomType("custom-1");
    return { snapshot: store.getSnapshot(), id1, relError, refusedDelete, allowedDelete };
  }

  const localStore = createLocalRequirementsStore(seedDoc());
  const localResult = runSequence(localStore);

  const yjsSeed = seedYjsStore();
  const yjsResult = runSequence(yjsSeed.store);

  let adapterDoc = seedDoc();
  const adapterStore = createAdapterRequirementsStore(
    () => adapterDoc,
    (updater) => {
      adapterDoc = updater(adapterDoc);
    }
  );
  const adapterResult = runSequence(adapterStore);

  assert(localResult.id1 === yjsResult.id1, `local and Yjs stores generate the identical first item id ("${localResult.id1}" vs "${yjsResult.id1}") from the same starting state`);
  assert(localResult.id1 === adapterResult.id1, `the adapter store generates the identical first item id too ("${adapterResult.id1}")`);
  assert(localResult.relError === null && yjsResult.relError === null, "the relationship was added without error in both stores (added before the target was deleted)");
  assert(
    localResult.refusedDelete === false && yjsResult.refusedDelete === false && adapterResult.refusedDelete === false,
    "all three stores refuse to delete a type that still has an item, and report the refusal identically"
  );
  assert(
    localResult.allowedDelete === true && yjsResult.allowedDelete === true && adapterResult.allowedDelete === true,
    "all three stores allow the same delete once the last item using that type is gone"
  );
  assert(
    canonicalJSON(localResult.snapshot) === canonicalJSON(yjsResult.snapshot),
    "local and Yjs stores produce an IDENTICAL snapshot after the same sequence of operations (add, update, categorize, relate, delete) - the Yjs implementation is a faithful drop-in for single-user use"
  );
  assert(
    canonicalJSON(localResult.snapshot) === canonicalJSON(adapterResult.snapshot),
    "the adapter store (delegating to an externally-owned setSnapshot, matching how App.tsx's undoable state works) produces an IDENTICAL snapshot too"
  );
}

// === Part 2: multi-peer CRDT scenarios ===

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

function forkPeer(sourceDoc: Y.Doc): { doc: Y.Doc; store: RequirementsStore } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(sourceDoc));
  return { doc, store: createYjsRequirementsStore(doc) };
}

// 2a. Two peers concurrently edit DIFFERENT FIELDS of the SAME item - the core guarantee, same as team's.
{
  const peerA = seedYjsStore();
  const itemId = peerA.store.addItem("requirement");
  const peerB = forkPeer(peerA.doc);

  peerA.store.updateItem(itemId, { title: "Changed by A" });
  peerB.store.updateItem(itemId, { body: "Changed by B" });

  sync(peerA.doc, peerB.doc);

  const itemA = peerA.store.getSnapshot().items.find((i) => i.id === itemId)!;
  const itemB = peerB.store.getSnapshot().items.find((i) => i.id === itemId)!;
  assert(itemA.title === "Changed by A" && itemA.body === "Changed by B", "peer A's merged view has BOTH concurrent field edits on the same item - A's title change and B's body change both survived");
  assert(itemB.title === "Changed by A" && itemB.body === "Changed by B", "peer B's merged view matches peer A's exactly");
}

// 2b. Concurrent add of DIFFERENT items (different types even) converges cleanly.
{
  const peerA = seedYjsStore();
  const peerB = forkPeer(peerA.doc);

  const idFromA = peerA.store.addItem("requirement");
  const idFromB = peerB.store.addItem("goal");

  sync(peerA.doc, peerB.doc);

  const idsA = peerA.store.getSnapshot().items.map((i) => i.id).sort();
  const idsB = peerB.store.getSnapshot().items.map((i) => i.id).sort();
  assert(idsA.includes(idFromA) && idsA.includes(idFromB), "peer A sees both concurrently-created items after sync");
  assert(JSON.stringify(idsA) === JSON.stringify(idsB), "both peers converge to the identical item list");
}

// 2c. Delete-vs-edit race on an item, same shape as team's member race.
{
  const peerA = seedYjsStore();
  const itemId = peerA.store.addItem("requirement");
  const peerB = forkPeer(peerA.doc);

  peerA.store.deleteItem(itemId);
  peerB.store.updateItem(itemId, { title: "B didn't know it was deleted" });

  sync(peerA.doc, peerB.doc);

  assert(peerA.store.getSnapshot().items.find((i) => i.id === itemId) === undefined, "the delete wins on peer A - not resurrected by B's concurrent edit");
  assert(peerB.store.getSnapshot().items.find((i) => i.id === itemId) === undefined, "the delete wins on peer B too - both converge to the same outcome");
}

// 2d. Concurrent relationship additions between different item pairs merge cleanly.
{
  const peerA = seedYjsStore();
  const a1 = peerA.store.addItem("requirement");
  const a2 = peerA.store.addItem("requirement");
  const a3 = peerA.store.addItem("requirement");
  const peerB = forkPeer(peerA.doc);

  peerA.store.addRelationship("blocks", a1, a2);
  peerB.store.addRelationship("blocks", a2, a3);

  sync(peerA.doc, peerB.doc);

  assert(peerA.store.getSnapshot().relationships.length === 2, "both concurrently-added relationships survive the merge on peer A");
  assert(peerB.store.getSnapshot().relationships.length === 2, "both peers converge to the same two relationships");
}

// === Part 3: the id-collision FIX - both items survive with distinct ids, zero data loss ===
{
  const peerA = seedYjsStore();
  const peerB = forkPeer(peerA.doc);

  // Both peers, disconnected, create an item of the SAME type. Neither
  // has seen the other's change - both still compute the same candidate
  // display id (this part is fundamentally unavoidable for genuinely
  // disconnected peers - see addItem's doc comment). Each also sets a
  // distinct title on their own item, specifically so a real data-loss
  // regression here wouldn't accidentally pass by leaving both items
  // empty.
  const idFromA = peerA.store.addItem("requirement");
  peerA.store.updateItem(idFromA, { title: "Written by peer A" });
  const idFromB = peerB.store.addItem("requirement");
  peerB.store.updateItem(idFromB, { title: "Written by peer B" });

  assert(idFromA === idFromB, `both disconnected peers still independently compute the same candidate display id ("${idFromA}") - this part of the scenario is unavoidable and unchanged; what matters is what happens next`);

  sync(peerA.doc, peerB.doc);

  const itemsA = peerA.store.getSnapshot().items;
  const itemsB = peerB.store.getSnapshot().items;
  const titlesA = itemsA.map((i) => i.title).sort();

  assert(itemsA.length === 2, "BOTH items survive after sync - not one silently discarded, not a duplicate row showing one item's content twice");
  assert(JSON.stringify(titlesA) === JSON.stringify(["Written by peer A", "Written by peer B"]), "BOTH peers' actual data (their distinct titles) survived intact - the fix separates the collision-prone display id from the collision-proof internal storage key each item actually lives under");
  assert(new Set(itemsA.map((i) => i.id)).size === 2, "the two surviving items now have DIFFERENT display ids - the collision was automatically, deterministically repaired rather than left in place");
  assert(
    JSON.stringify(itemsA.map((i) => ({ id: i.id, title: i.title })).sort((a, b) => a.id.localeCompare(b.id))) ===
      JSON.stringify(itemsB.map((i) => ({ id: i.id, title: i.title })).sort((a, b) => a.id.localeCompare(b.id))),
    "both peers converge to the IDENTICAL final state (same two items, same ids, same titles) - the repair is deterministic, not a coin flip that could differ between peers"
  );
}

// === Part 4: THREE-way collision - verifies the repair generalizes beyond just two colliding peers ===
{
  const peerA = seedYjsStore();
  const peerB = forkPeer(peerA.doc);
  const peerC = forkPeer(peerA.doc);

  const idFromA = peerA.store.addItem("requirement");
  peerA.store.updateItem(idFromA, { title: "A" });
  const idFromB = peerB.store.addItem("requirement");
  peerB.store.updateItem(idFromB, { title: "B" });
  const idFromC = peerC.store.addItem("requirement");
  peerC.store.updateItem(idFromC, { title: "C" });

  assert(idFromA === idFromB && idFromB === idFromC, "all three disconnected peers independently compute the same candidate display id");

  // Sync all three pairwise, twice, so every peer's updates propagate to
  // every other peer regardless of merge order.
  sync(peerA.doc, peerB.doc);
  sync(peerB.doc, peerC.doc);
  sync(peerA.doc, peerC.doc);
  sync(peerA.doc, peerB.doc);

  const itemsA = peerA.store.getSnapshot().items;
  const itemsC = peerC.store.getSnapshot().items;
  assert(itemsA.length === 3, "all THREE concurrently-created items survive a three-way collision, not just two");
  assert(new Set(itemsA.map((i) => i.id)).size === 3, "all three end up with distinct display ids after repair");
  assert(JSON.stringify(itemsA.map((i) => i.title).sort()) === JSON.stringify(["A", "B", "C"]), "all three peers' distinct titles survived - no data loss even with three-way contention");
  assert(
    JSON.stringify(itemsA.map((i) => ({ id: i.id, title: i.title })).sort((a, b) => a.id.localeCompare(b.id))) ===
      JSON.stringify(itemsC.map((i) => ({ id: i.id, title: i.title })).sort((a, b) => a.id.localeCompare(b.id))),
    "peer A and peer C (the two that never synced directly with each other) still converge to the identical final state"
  );
}

// === Part 5: deleteCustomType refuses while the type is still in use ===
// This replaces what used to be a cascade (deleting the type also
// deleted every item of that type and every relationship touching one).
// An item's display id is built from its type's prefix, so there is no
// coherent state to leave those items in - but destroying them to tidy
// up a type definition is silent, unrecoverable data loss. Refusing is
// the safer failure, and it has to be enforced in the store rather than
// only in the UI, since a collaborator can add an item of this type
// between the modal rendering and the click landing.
{
  const testDoc = new Y.Doc();
  seedBuiltInTypesIfEmpty(testDoc);
  const store = createYjsRequirementsStore(testDoc);
  const addTypeOk = store.addCustomType("Widget", "WID", "#5b7cfa", true);
  assert(addTypeOk, "custom type created successfully as test setup");
  const idA = store.addItem("custom-1");
  const idB = store.addItem("requirement");
  const relError = store.addRelationship("blocks", idA, idB);
  assert(relError === null, "relationship created successfully as test setup");

  const refused = store.deleteCustomType("custom-1");

  assert(refused === false, "deleting a type that still has items returns false");
  const blocked = store.getSnapshot();
  assert(blocked.itemTypes.some((t) => t.id === "custom-1"), "the refused type is still present - the refusal is a genuine no-op, not a partial delete");
  assert(blocked.items.some((i) => i.id === idA), "the item using the type is untouched - this is the data loss the old cascade caused");
  assert(blocked.relationships.length === 1, "the relationship touching that item is untouched too");

  // Clearing the last item using the type unblocks it.
  store.deleteItem(idA);
  const allowed = store.deleteCustomType("custom-1");

  assert(allowed === true, "once nothing uses the type, deleting it succeeds");
  const after = store.getSnapshot();
  assert(after.itemTypes.every((t) => t.id !== "custom-1"), "the now-unused type is actually removed");
  assert(after.items.some((i) => i.id === idB), "the unrelated item of a different type is left alone");
}

// === Part 5b: deleteCategory clears the reference on every item using it ===
// Unlike a type, a category is an optional label - deleting it is never
// blocked, but every item pointing at it has to be cleared or it renders
// as a dangling reference rather than as uncategorized.
{
  const testDoc = new Y.Doc();
  seedBuiltInTypesIfEmpty(testDoc);
  const store = createYjsRequirementsStore(testDoc);
  const idA = store.addItem("requirement");
  const idB = store.addItem("requirement");
  const idC = store.addItem("requirement");
  store.createAndAssignCategory(idA, "Auth");
  store.createAndAssignCategory(idB, "Auth");
  store.createAndAssignCategory(idC, "Billing");

  const authId = store.getSnapshot().categories.find((c) => c.label === "Auth")!.id;
  store.deleteCategory(authId);

  const snap = store.getSnapshot();
  assert(snap.categories.every((c) => c.id !== authId), "the deleted category is gone from the document");
  assert(snap.items.find((i) => i.id === idA)!.categoryId === undefined, "the first item that used it is now uncategorized, not left pointing at a category that no longer exists");
  assert(snap.items.find((i) => i.id === idB)!.categoryId === undefined, "every item that used it is cleared, not just the first one found");
  assert(snap.items.find((i) => i.id === idC)!.categoryId !== undefined, "an item in a DIFFERENT category keeps its own assignment");
  assert(snap.items.length === 3, "no items are removed - deleting a category only ever drops the label");
}

// === Part 6: seedYjsRequirementsDoc - starting a session must preserve existing work exactly, not lose or mangle it ===
{
  // Build a realistic "existing document" - the kind of thing a person
  // would already have before ever starting a collaborative session -
  // using the LOCAL store, so its ids are generated exactly the way
  // they'd be in a real, already-in-use document.
  const existingStore = createLocalRequirementsStore(seedDoc());
  const itemA = existingStore.addItem("requirement");
  const itemB = existingStore.addItem("goal");
  existingStore.updateItem(itemA, { title: "Existing item A", body: "Some body text" });
  existingStore.createAndAssignCategory(itemA, "Auth");
  const addTypeOk = existingStore.addCustomType("Widget", "WID", "#5b7cfa", true);
  const itemC = existingStore.addItem("custom-1");
  const relError = existingStore.addRelationship("blocks", itemA, itemB);
  const existingSnapshot = existingStore.getSnapshot();

  assert(addTypeOk, "custom type created successfully as test setup");
  assert(relError === null, "relationship created successfully as test setup");

  // Now seed a brand-new Y.Doc from that existing snapshot, exactly as
  // starting a new collaborative session would.
  const doc = new Y.Doc();
  seedYjsRequirementsDoc(doc, existingSnapshot);
  const seededStore = createYjsRequirementsStore(doc);
  const seededSnapshot = seededStore.getSnapshot();

  assert(
    canonicalJSON(existingSnapshot) === canonicalJSON(seededSnapshot),
    "seeding a fresh Y.Doc from an existing document and reading it back produces an EXACT match, including every original id (item ids like the seeded 'REQ-1', the custom type's 'custom-1', the category's 'category-1') - nothing lost, nothing renumbered"
  );

  // Cross-references specifically - the part that would silently break
  // if seeding ever regenerated an id instead of preserving it.
  const seededItemA = seededSnapshot.items.find((i) => i.id === itemA)!;
  assert(seededItemA.categoryId === existingSnapshot.items.find((i) => i.id === itemA)!.categoryId, "the seeded item's categoryId still correctly references the same (preserved) category id");
  assert(seededSnapshot.relationships.some((r) => r.fromItemId === itemA && r.toItemId === itemB), "the seeded relationship still correctly references both original item ids");
  assert(seededSnapshot.items.some((i) => i.id === itemC && i.typeId === "custom-1"), "the item created under the custom type still correctly references the custom type's preserved id");

  // Confirm the doc is NOT still empty when createYjsRequirementsStore's
  // own "seed built-ins if empty" check runs - it should see real data
  // already there and skip injecting its own defaults on top.
  const builtInCount = seededSnapshot.itemTypes.filter((t) => t.isBuiltIn).length;
  const originalBuiltInCount = existingSnapshot.itemTypes.filter((t) => t.isBuiltIn).length;
  assert(builtInCount === originalBuiltInCount, "built-in types appear exactly once each after seeding - not duplicated by createYjsRequirementsStore's own empty-doc default-seeding logic running on top of already-seeded data");
}

// === Part 8: the exact real-world join-session scenario - a host's seeded session, a guest joining with a genuinely empty (unseeded) doc, then CRDT sync ===
// A real bug this specifically catches: createYjsRequirementsStore used
// to auto-seed built-in types into ANY doc that appeared empty at
// construction time, including a guest's doc in the brief window before
// WebRTC sync with the host has happened - meaning both sides would
// independently create their OWN built-in type entries, which Y.Arrays
// (itemTypeOrder) don't deduplicate by value, producing duplicate
// entries once merged, and Y.Map key collisions on the nested type
// objects non-deterministically discarding one side's data. This test
// builds the exact real sequence - host store fully seeded (as
// startNewSession does), guest store constructed on a bare, unseeded
// Y.Doc (as joinSession does, with NO seedBuiltInTypesIfEmpty call at
// all) - then syncs them, exactly as WebRTC would.
{
  const hostStore = createLocalRequirementsStore(seedDoc());
  hostStore.addItem("requirement");
  const hostSnapshot = hostStore.getSnapshot();

  const hostDoc = new Y.Doc();
  seedYjsRequirementsDoc(hostDoc, hostSnapshot);

  // The guest's doc: bare, unseeded - exactly what joinSession actually
  // does (no seedBuiltInTypesIfEmpty call, unlike the other tests in
  // this file that deliberately opt into it for their own setup needs).
  const guestDoc = new Y.Doc();
  const guestStore = createYjsRequirementsStore(guestDoc);

  const guestSnapshotBeforeSync = guestStore.getSnapshot();
  assert(guestSnapshotBeforeSync.itemTypes.length === 0, "before any sync happens, the guest's doc is genuinely empty - no locally-seeded built-ins sitting there waiting to conflict with the host's");

  // Simulate the WebRTC sync itself - the actual mechanism, not a stand-in for it.
  Y.applyUpdate(guestDoc, Y.encodeStateAsUpdate(hostDoc));
  Y.applyUpdate(hostDoc, Y.encodeStateAsUpdate(guestDoc));

  const guestSnapshotAfterSync = guestStore.getSnapshot();
  const builtInTypeIds = guestSnapshotAfterSync.itemTypes.filter((t) => t.isBuiltIn).map((t) => t.id);
  const uniqueBuiltInTypeIds = new Set(builtInTypeIds);
  assert(
    builtInTypeIds.length === uniqueBuiltInTypeIds.size,
    "after syncing with the host, the guest has each built-in type exactly ONCE - no duplicates from the guest having independently seeded its own copy before sync happened"
  );
  assert(
    guestSnapshotAfterSync.items.some((i) => i.id === "REQ-1"),
    "the guest correctly receives the host's actual item after sync - this is the specific, real-world symptom this bug produced: a guest seeing none of the host's data"
  );

  const hostSnapshotAfterSync = createYjsRequirementsStore(hostDoc).getSnapshot();
  assert(
    canonicalJSON({ itemTypes: hostSnapshotAfterSync.itemTypes, items: hostSnapshotAfterSync.items }) ===
      canonicalJSON({ itemTypes: guestSnapshotAfterSync.itemTypes, items: guestSnapshotAfterSync.items }),
    "host and guest converge to an IDENTICAL final state after sync - no corruption or divergence from the guest's construction-time seeding attempt"
  );
}

// === Part 9: repairDuplicateDisplayIds resolves a collision in ONE pass even when nextSequence is badly stale and many existing ids are already taken - the exact scenario a real user's large project (73+ items) hit, which looked like an infinite loop ===
// Before this fix: repairDuplicateDisplayIds assigned nextSequence's
// value outright without checking whether it was actually free. If
// nextSequence was stale (lower than the highest sequence number
// already in use for that type - however that staleness arose), the
// "repaired" id would immediately collide with ANOTHER existing item,
// creating a fresh collision for the NEXT observeDeep-triggered repair
// round to find - repeating once per already-used id in sequence. For a
// project with dozens of existing items, that cascade of many
// back-to-back repair-triggered re-renders is exactly what a real user
// experienced as edges never rendering: the render loop never got a
// stable moment to actually paint anything.
{
  const doc = new Y.Doc();
  const itemOrder = doc.getArray<string>("itemOrder");
  const items = doc.getMap<Y.Map<unknown>>("items");
  const nextSequenceMap = doc.getMap<number>("nextSequence");
  const itemTypeOrder = doc.getArray<string>("itemTypeOrder");
  const itemTypes = doc.getMap<Y.Map<unknown>>("itemTypes");

  doc.transact(() => {
    const typeMap = new Y.Map<unknown>();
    typeMap.set("label", "Requirement");
    typeMap.set("prefix", "REQ");
    typeMap.set("color", "#000000");
    typeMap.set("isBuiltIn", true);
    typeMap.set("isWorkable", true);
    itemTypes.set("requirement", typeMap);
    itemTypeOrder.push(["requirement"]);

    // 20 pre-existing items, correctly using REQ-1 through REQ-20 - no
    // collisions among THESE on their own.
    for (let i = 1; i <= 20; i++) {
      const m = new Y.Map<unknown>();
      m.set("id", `REQ-${i}`);
      m.set("typeId", "requirement");
      m.set("title", `Item ${i}`);
      m.set("status", "todo");
      m.set("categoryId", undefined);
      m.set("properties", {});
      items.set(`item-${i}`, m);
      itemOrder.push([`item-${i}`]);
    }

    // A 21st item that collides with the FIRST one (both claim REQ-1) -
    // the actual trigger for repair.
    const colliding = new Y.Map<unknown>();
    colliding.set("id", "REQ-1");
    colliding.set("typeId", "requirement");
    colliding.set("title", "Colliding item");
    colliding.set("status", "todo");
    colliding.set("categoryId", undefined);
    colliding.set("properties", {});
    items.set("item-21", colliding);
    itemOrder.push(["item-21"]);

    // The critical setup: nextSequence badly stale at 1, despite 20
    // items already using REQ-1 through REQ-20.
    nextSequenceMap.set("requirement", 1);
  });

  // Constructing the store runs repairDuplicateDisplayIds() once, up
  // front (see this file's own comment on why: a collision could
  // already be baked in from a prior session, before this store
  // instance existed to observe anything) - if that single call doesn't
  // fully resolve it, something is still wrong.
  const store = createYjsRequirementsStore(doc);
  const snapshot = store.getSnapshot();

  const displayIds = snapshot.items.map((i) => i.id);
  const uniqueDisplayIds = new Set(displayIds);
  assert(
    displayIds.length === uniqueDisplayIds.size,
    `after constructing the store just once, every item has a unique display id - got [${displayIds.sort().join(", ")}]`
  );

  const repairedItem = snapshot.items.find((i) => i.title === "Colliding item");
  assert(
    repairedItem !== undefined && !["REQ-1", "REQ-2", "REQ-3", "REQ-4", "REQ-5"].includes(repairedItem.id),
    `the colliding item was correctly reassigned PAST every already-used id, not just handed nextSequence's stale value outright - got "${repairedItem?.id}"`
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
