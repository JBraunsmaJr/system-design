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

// === Part 22: concurrent category assignment vs. category deletion ===
// Two peers each make an edit that is perfectly valid against the state
// they can see: one assigns an item to a category, the other deletes
// that same category (having no items under it at the time). The
// assignment and the deletion touch different maps, so Yjs merges both
// and the item is left pointing at a category that no longer exists.
// Neither mutator can prevent this - by the time the other peer's edit
// arrives, both have already run - so the repair happens on the
// post-change path instead.
{
  const docA = new Y.Doc();
  seedBuiltInTypesIfEmpty(docA);
  const storeA = createYjsRequirementsStore(docA);
  const firstId = storeA.addItem("requirement");
  storeA.addItem("requirement");
  storeA.createAndAssignCategory(firstId, "Auth");
  const categoryId = storeA.getSnapshot().categories[0].id;

  const docB = new Y.Doc();
  const storeB = createYjsRequirementsStore(docB);
  sync(docA, docB);

  const secondId = storeB.getSnapshot().items[1].id;
  storeA.createAndAssignCategory(secondId, "Auth"); // resolves to the existing category by label
  storeB.deleteCategory(categoryId);

  sync(docA, docB);

  const snapA = storeA.getSnapshot();
  const snapB = storeB.getSnapshot();
  const danglingA = snapA.items.filter((i) => i.categoryId && !snapA.categories.some((c) => c.id === i.categoryId));

  assert(danglingA.length === 0, "after a concurrent assign-vs-delete merge, no item is left pointing at a category that no longer exists");
  assert(snapA.items.length === 2, "and both items survive - only the label was dropped, never the item");
  assert(
    JSON.stringify(snapA.items.map((i) => i.categoryId)) === JSON.stringify(snapB.items.map((i) => i.categoryId)),
    "both peers converge on the same repaired state, since the repair is deterministic and every peer runs it over the same merged document"
  );
}

// === Part 23: concurrent item creation vs. custom type deletion ===
// The race deleteCustomType's own guard explicitly can't close: the
// guard correctly sees no items using the type, because the item that
// uses it hasn't arrived yet. Repaired in the opposite direction from a
// category - the TYPE is restored rather than the item reassigned,
// because the item's display id, its relationships and any #WID-1
// references in other items all derive from that type. It also has to
// be restored for the item to be visible at all: "group by type" builds
// groups from the types that exist, so an item whose type is gone
// appears in none of them.
{
  const docA = new Y.Doc();
  seedBuiltInTypesIfEmpty(docA);
  const storeA = createYjsRequirementsStore(docA);
  const added = storeA.addCustomType("Widget", "WID", "#5b7cfa", true);
  assert(added, "custom type created as test setup");

  const docB = new Y.Doc();
  const storeB = createYjsRequirementsStore(docB);
  sync(docA, docB);

  const itemId = storeA.addItem("custom-1");
  const deleted = storeB.deleteCustomType("custom-1");
  assert(deleted === true, "the deleting peer's in-use guard passes, because the item using the type hasn't reached it yet");

  sync(docA, docB);

  const snapA = storeA.getSnapshot();
  const snapB = storeB.getSnapshot();
  const orphans = snapA.items.filter((i) => !snapA.itemTypes.some((t) => t.id === i.typeId));

  assert(orphans.length === 0, "after the merge no item is left with a type that doesn't exist - which would have made it invisible in the default group-by-type view");
  assert(snapA.items.some((i) => i.id === itemId), `the concurrently-created item still exists, keeping its original display id (${itemId})`);

  const restored = snapA.itemTypes.find((t) => t.id === "custom-1");
  assert(restored !== undefined, "the type is restored rather than the item being reassigned to some fallback");
  assert(restored?.label === "Widget", "restored from the tombstone deleteCustomType recorded, so the real label survives rather than being reconstructed from the display-id prefix");
  assert(restored?.prefix === "WID", "and its prefix, which the item's display id depends on");
  assert(restored?.color === "#5b7cfa", "and its color");
  assert(restored?.isWorkable === true, "and isWorkable - the field that decides whether these items can go into a sprint at all, and the one a prefix-derived guess would get wrong");
  assert(
    JSON.stringify(snapA.itemTypes) === JSON.stringify(snapB.itemTypes) && JSON.stringify(snapA.items) === JSON.stringify(snapB.items),
    "both peers converge on the same restored type and items"
  );
}

// === Part 24: an uncontested type deletion still just deletes ===
// The repair must not resurrect types that were legitimately removed -
// it only fires when something still references them.
{
  const testDoc = new Y.Doc();
  seedBuiltInTypesIfEmpty(testDoc);
  const store = createYjsRequirementsStore(testDoc);
  store.addCustomType("Widget", "WID", "#5b7cfa", true);
  const temp = store.addItem("custom-1");
  store.deleteItem(temp);

  assert(store.deleteCustomType("custom-1") === true, "an unused custom type deletes normally");
  const snap = store.getSnapshot();
  assert(snap.itemTypes.every((t) => t.id !== "custom-1"), "and stays deleted - the repair does not resurrect a type nothing references");
}

// === Part 25: a reused custom id doesn't resurrect the old definition ===
// addCustomType hands out the smallest unused custom-N, so an id can be
// reused. A stale tombstone under that id describes an unrelated type.
{
  const testDoc = new Y.Doc();
  seedBuiltInTypesIfEmpty(testDoc);
  const store = createYjsRequirementsStore(testDoc);
  store.addCustomType("Widget", "WID", "#5b7cfa", true);
  store.deleteCustomType("custom-1");
  store.addCustomType("Gadget", "GAD", "#f0578c", false);

  const reused = store.getSnapshot().itemTypes.find((t) => t.id === "custom-1");
  assert(reused?.label === "Gadget", "the reused id carries the NEW type's definition, not the tombstoned one");

  const itemId = store.addItem("custom-1");
  const snap = store.getSnapshot();
  assert(snap.items.find((i) => i.id === itemId) !== undefined, "and items created under it behave normally");
  assert(snap.itemTypes.filter((t) => t.id === "custom-1").length === 1, "with no duplicate type left behind");
}

// === Part 26: item type conversion, retroactive references, gap-filling sequence ===
{
  function verifyConversion(store: RequirementsStore, label: string) {
    store.addCustomType("LegacyEpic", "LEP", "#8b5cf6", false);
    const item1 = store.addItem("custom-1");
    const item2 = store.addItem("custom-1");
    store.updateItem(item1, { title: "Custom Item 1" });
    store.updateItem(item2, { title: "Custom Item 2" });

    // Single item convert changes ID to target type's prefix
    const newId1 = store.convertItemType(item1, "epic");
    let snap = store.getSnapshot();
    const convertedItem1 = snap.items.find((i) => i.id === newId1);
    assert(Boolean(newId1?.startsWith("EPIC-")), `[${label}] single item conversion updates ID to prefix of target type`);
    assert(convertedItem1?.typeId === "epic", `[${label}] single item conversion updates typeId to epic`);
    assert(convertedItem1?.title === "Custom Item 1", `[${label}] single item conversion preserves item title and data`);

    // Deleting custom-1 is still refused because item2 is using it
    assert(store.deleteCustomType("custom-1") === false, `[${label}] delete custom type refused when items remain`);

    // Batch convert / transfer all items of custom-1 to dependency
    const count = store.convertAllItemsOfType("custom-1", "dependency");
    assert(count === 1, `[${label}] convertAllItemsOfType returns the number of converted items`);

    snap = store.getSnapshot();
    const convertedItem2 = snap.items.find((i) => i.title === "Custom Item 2");
    assert(Boolean(convertedItem2?.id.startsWith("DEP-")), `[${label}] batch converted item gets target type prefix DEP-`);
    assert(convertedItem2?.typeId === "dependency", `[${label}] item2 converted to dependency`);

    // Now delete custom-1 succeeds
    assert(store.deleteCustomType("custom-1") === true, `[${label}] delete custom type succeeds after all items transferred`);

    // Workability transition test
    const ticketId = store.addItem("ticket");
    store.updateItem(ticketId, { status: "in-progress" });
    // Convert to non-workable epic
    const convertedEpicId = store.convertItemType(ticketId, "epic");
    snap = store.getSnapshot();
    const epicTicket = snap.items.find((i) => i.id === convertedEpicId);
    assert(epicTicket?.typeId === "epic" && epicTicket?.status === undefined, `[${label}] converting workable item to non-workable clears status/points`);

    // Convert back to workable ticket
    const restoredTicketId = store.convertItemType(convertedEpicId!, "ticket");
    snap = store.getSnapshot();
    const restoredTicket = snap.items.find((i) => i.id === restoredTicketId);
    assert(restoredTicket?.typeId === "ticket" && restoredTicket?.status === "todo", `[${label}] converting non-workable item to workable sets default status to todo`);
  }

  const localStore = createLocalRequirementsStore(seedDoc());
  verifyConversion(localStore, "LocalStore");

  const yjsStore = seedYjsStore().store;
  verifyConversion(yjsStore, "YjsStore");

  let adapterDoc = seedDoc();
  const adapterStore = createAdapterRequirementsStore(
    () => adapterDoc,
    (updater) => {
      adapterDoc = updater(adapterDoc);
    }
  );
  verifyConversion(adapterStore, "AdapterStore");
}

// === Part 27: Retroactive reference updating and gap-filling IDs ===
{
  function verifyReferencesAndGapFilling(store: RequirementsStore, label: string) {
    // 1. Given REQ-1, REQ-2 and a referencing item referencing REQ-2
    // and a relationship between REQ-1 and REQ-2
    const req1 = store.addItem("requirement");
    const req2 = store.addItem("requirement");
    const refItem = store.addItem("requirement");
    store.updateItem(refItem, {
      body: `This depends on #${req2} and has a link [#${req2}](#ref:${req2}) inside text.`,
    });
    store.addRelationship("rel-type-blocks", req1, req2);

    // Convert REQ-2 to dependency -> should become DEP-1
    const dep1 = store.convertItemType(req2, "dependency");
    assert(dep1 === "DEP-1", `[${label}] REQ-2 converted to dependency becomes DEP-1`);

    let snap = store.getSnapshot();
    const updatedRefItem = snap.items.find((i) => i.id === refItem);
    assert(
      updatedRefItem?.body === "This depends on #DEP-1 and has a link [#DEP-1](#ref:DEP-1) inside text.",
      `[${label}] body references retroactively updated from #${req2} to #${dep1}`
    );

    const rel = snap.relationships.find((r) => r.fromItemId === req1);
    assert(rel?.toItemId === "DEP-1", `[${label}] relationship target retroactively updated from ${req2} to DEP-1`);

    // 2. Gap filling sequence on deletion:
    // Create DEP-2 and DEP-3
    const dep2 = store.addItem("dependency");
    const dep3 = store.addItem("dependency");
    assert(dep2 === "DEP-2", `[${label}] created DEP-2`);
    assert(dep3 === "DEP-3", `[${label}] created DEP-3`);

    // Delete DEP-2
    store.deleteItem("DEP-2");

    // Next created dependency should be DEP-2, then DEP-4
    const nextDepA = store.addItem("dependency");
    assert(nextDepA === "DEP-2", `[${label}] gap-filling assigns DEP-2 after DEP-2 was deleted`);

    const nextDepB = store.addItem("dependency");
    assert(nextDepB === "DEP-4", `[${label}] after filling DEP-2, next is DEP-4`);
  }

  const localStore = createLocalRequirementsStore(seedDoc());
  verifyReferencesAndGapFilling(localStore, "LocalStore");

  const yjsStore = seedYjsStore().store;
  verifyReferencesAndGapFilling(yjsStore, "YjsStore");

  let adapterDoc = seedDoc();
  const adapterStore = createAdapterRequirementsStore(
    () => adapterDoc,
    (updater) => {
      adapterDoc = updater(adapterDoc);
    }
  );
  verifyReferencesAndGapFilling(adapterStore, "AdapterStore");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
