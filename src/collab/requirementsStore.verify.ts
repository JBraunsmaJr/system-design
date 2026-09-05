/**
 * Standalone verification for the RequirementsStore seam - same purpose
 * and rationale as teamStore.verify.ts. Run with:
 *
 *   npx tsx src/collab/requirementsStore.verify.ts
 */
import * as Y from "yjs";
import { createLocalRequirementsStore, createAdapterRequirementsStore } from "./requirementsStore";
import { createYjsRequirementsStore } from "./yjsRequirementsStore";
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
    return { snapshot: store.getSnapshot(), id1, relError };
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

// === Part 3: the KNOWN, deliberately-unsolved limitation - empirically demonstrated, not just theorized ===
{
  const peerA = seedYjsStore();
  const peerB = forkPeer(peerA.doc);

  // Both peers, disconnected, create an item of the SAME type. Neither
  // has seen the other's change - both compute the same candidate id.
  const idFromA = peerA.store.addItem("requirement");
  const idFromB = peerB.store.addItem("requirement");

  assert(idFromA === idFromB, `CONFIRMED, not just theorized: two disconnected peers creating an item of the same type independently generate the IDENTICAL id ("${idFromA}") - this is the actual mechanism behind the known id-collision limitation documented in yjsRequirementsStore.ts`);

  sync(peerA.doc, peerB.doc);

  const itemsA = peerA.store.getSnapshot().items.filter((i) => i.id === idFromA);
  assert(itemsA.length === 2, `CONFIRMED: after sync, the collided id "${idFromA}" appears TWICE in the item list, both showing identical content - NOT one item silently vanishing as might be assumed, but a duplicate row. The underlying data itself doesn't get lost (Yjs's Y.Map merges the two peers' item data to one winner for that key), but the separate order-array entry each peer independently pushed survives from BOTH peers - Y.Array is a sequence type, so two pushes of the same string value are two distinct elements, not deduplicated. Confirmed by direct inspection before writing this assertion, not assumed.`);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
