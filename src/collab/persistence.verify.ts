/**
 * WS2-R1, WS2-R2, WS2-R6.
 *
 * The ordering under test is the whole point: persistence must finish
 * replaying stored updates BEFORE anything decides whether to seed. Get it
 * backwards and a restored document is seeded on top of itself, which - before
 * WS1-R6 - silently duplicated every node, requirement and milestone.
 */
import "fake-indexeddb/auto";
import * as Y from "yjs";
import {
  attachPersistence,
  createNullPersistence,
  persistenceKeyForRoom,
} from "./persistence.ts";
import { seedYjsDiagramDoc, createYjsDiagramStore } from "./yjsDiagramStore.ts";
import { isYjsDocEmpty } from "./seedGuards.ts";
import type { SubDiagram } from "../domain/types";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const root = {
  nodes: [
    {
      id: "n1",
      type: "typed",
      position: { x: 0, y: 0 },
      data: { nodeType: "service", label: "Gateway" },
    },
    {
      id: "n2",
      type: "typed",
      position: { x: 200, y: 0 },
      data: { nodeType: "database", label: "Postgres" },
    },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", type: "typed", data: {} },
  ],
} as unknown as SubDiagram;

/** The real sequence a caller must follow. */
async function openRoom(roomName: string, seed?: SubDiagram) {
  const doc = new Y.Doc();
  const persistence = attachPersistence(doc, persistenceKeyForRoom(roomName));
  await persistence.whenSynced;
  if (persistence.wasEmptyOnLoad() && seed) {
    seedYjsDiagramDoc(doc, seed);
  }
  return { doc, persistence };
}

console.log("=== Keys are namespaced per room ===");
{
  assert(
    persistenceKeyForRoom("session-abc") !== persistenceKeyForRoom("session-abd"),
    "two rooms get distinct keys",
  );
  assert(
    persistenceKeyForRoom("session-abc").includes("session-abc"),
    "the key identifies the room",
  );
}

console.log("=== A document survives closing and reopening ===");
{
  const room = `room-${Math.random().toString(36).slice(2)}`;
  const first = await openRoom(room, root);
  assert(
    createYjsDiagramStore(first.doc).getSnapshot().nodes.length === 2,
    "a fresh room is seeded",
  );
  await first.persistence.destroy();

  // Everyone has left; a participant returns.
  const second = await openRoom(room, root);
  const snapshot = createYjsDiagramStore(second.doc).getSnapshot();
  assert(
    snapshot.nodes.length === 2,
    "reopening restores the document from disk, not from a peer",
  );
  assert(
    !second.persistence.wasEmptyOnLoad(),
    "the restored document is correctly reported as non-empty",
  );
  assert(
    new Set(second.doc.getArray<string>("nodeOrder").toArray()).size === 2,
    "and reopening did not seed on top of the restored content",
  );
  await second.persistence.destroy();
}

console.log("=== Edits made in one session are there in the next ===");
{
  const room = `room-${Math.random().toString(36).slice(2)}`;
  const first = await openRoom(room, root);
  createYjsDiagramStore(first.doc).addNode([], "typed", { x: 400, y: 0 }, {
    nodeType: "service",
    label: "Added later",
  } as never);
  // Give the provider a turn to write the update out.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await first.persistence.destroy();

  const second = await openRoom(room, root);
  const labels = createYjsDiagramStore(second.doc)
    .getSnapshot()
    .nodes.map((n) => (n.data as { label?: string }).label);
  assert(
    labels.includes("Added later"),
    "an edit made after seeding survives the round trip",
  );
  await second.persistence.destroy();
}

console.log("=== Leaving is not forgetting (WS2-R6) ===");
{
  const room = `room-${Math.random().toString(36).slice(2)}`;
  const first = await openRoom(room, root);
  await first.persistence.destroy();

  const second = await openRoom(room);
  assert(
    !isYjsDocEmpty(second.doc),
    "destroy() leaves the local replica intact - disconnecting must never discard work",
  );

  await second.persistence.forget();

  const third = await openRoom(room);
  assert(
    isYjsDocEmpty(third.doc),
    "forget() erases it - a separate, deliberate action",
  );
  await third.persistence.destroy();
}

console.log("=== Reading the seed decision too early is an error ===");
{
  const doc = new Y.Doc();
  const persistence = attachPersistence(doc, persistenceKeyForRoom("eager"));
  let threw = false;
  try {
    persistence.wasEmptyOnLoad();
  } catch {
    threw = true;
  }
  assert(
    threw,
    "wasEmptyOnLoad() before whenSynced throws rather than returning a guess",
  );
  await persistence.whenSynced;
  await persistence.destroy();
}

console.log("=== A failing provider degrades to seeding, not to a blank canvas ===");
{
  const doc = new Y.Doc();
  const persistence = attachPersistence(doc, "irrelevant", {
    createProvider: () =>
      ({
        whenSynced: Promise.reject(new Error("storage denied")),
        destroy: async () => {},
        clearData: async () => {},
      }) as never,
  });
  await persistence.whenSynced;
  assert(
    persistence.wasEmptyOnLoad(),
    "an unavailable database reports empty, so the caller still seeds",
  );
  await persistence.destroy();
}

console.log("=== Null persistence ===");
{
  const doc = new Y.Doc();
  const persistence = createNullPersistence(doc);
  await persistence.whenSynced;
  assert(persistence.wasEmptyOnLoad(), "an empty doc reports empty");

  const seeded = new Y.Doc();
  seedYjsDiagramDoc(seeded, root);
  assert(
    !createNullPersistence(seeded).wasEmptyOnLoad(),
    "a populated doc reports non-empty even with no storage behind it",
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} persistence check(s) failed`);
}
console.log("\nAll persistence checks passed.");
