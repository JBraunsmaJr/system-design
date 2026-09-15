/**
 * WS1 Step 2 — opening a document.
 *
 * The ordering under test is load-then-decide-then-seed. Getting it backwards
 * seeds on top of content persistence is about to restore, and the sub-diagram
 * hierarchy is the part most likely to be quietly flattened on the way in.
 */
import "fake-indexeddb/auto";
import {
  openDocument,
  persistenceKeyForDocument,
  replaceDocumentContents,
} from "./localDocument.ts";
import { createYjsDiagramStore } from "./yjsDiagramStore.ts";
import { SCHEMA_VERSION, type DiagramFile } from "../domain/serialization.ts";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "../domain/requirementsTypes.ts";
import { EMPTY_TEAM_DOCUMENT } from "../domain/teamTypes.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

/** Nodes are FLAT with parentPath, exactly as DiagramFile stores them, with
 * one node nested two levels deep. */
function makeFile(title: string): DiagramFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes: [
      {
        id: "root-a",
        type: "typed",
        position: { x: 0, y: 0 },
        data: { nodeType: "service", label: "Gateway", parentPath: [] },
      },
      {
        id: "child-a",
        type: "typed",
        position: { x: 20, y: 20 },
        data: { nodeType: "service", label: "Inner", parentPath: ["root-a"] },
      },
      {
        id: "grandchild-a",
        type: "typed",
        position: { x: 40, y: 40 },
        data: {
          nodeType: "database",
          label: "Deepest",
          parentPath: ["root-a", "child-a"],
        },
      },
    ],
    edges: [],
    scenarios: [],
    requirements: EMPTY_REQUIREMENTS_DOCUMENT,
    programIncrements: [],
    team: EMPTY_TEAM_DOCUMENT,
    milestones: [],
    metadata: { updatedAt: "2026-01-01T00:00:00.000Z" },
  } as unknown as DiagramFile;
}

function parentPathsOf(doc: Parameters<typeof createYjsDiagramStore>[0]) {
  const store = createYjsDiagramStore(doc);
  const result = new Map<string, string[]>();
  for (const node of store.getSnapshot().nodes) {
    result.set(node.id, (node.data as { parentPath?: string[] }).parentPath ?? []);
  }
  store.destroy();
  return result;
}

console.log("=== Keys are namespaced away from rooms ===");
{
  assert(
    persistenceKeyForDocument("abc").includes(":doc:"),
    "a document key is distinguishable from a room key, so the two cannot collide",
  );
}

console.log("=== Seeding preserves the sub-diagram hierarchy ===");
{
  const opened = await openDocument({
    docId: `d-${Math.random().toString(36).slice(2)}`,
    initial: makeFile("Nested"),
  });
  assert(opened.wasSeeded, "an empty document is seeded");

  const paths = parentPathsOf(opened.doc);
  assert(paths.size === 3, "every node is present");
  assert(
    JSON.stringify(paths.get("child-a")) === JSON.stringify(["root-a"]),
    "a nested node keeps its parent",
  );
  assert(
    JSON.stringify(paths.get("grandchild-a")) ===
      JSON.stringify(["root-a", "child-a"]),
    "a node two levels deep keeps its full path - flattening an already-flat " +
      "list would have hoisted it to the root",
  );
  await opened.close();
}

console.log("=== Reopening restores rather than reseeds ===");
{
  const docId = `d-${Math.random().toString(36).slice(2)}`;
  const first = await openDocument({ docId, initial: makeFile("First") });
  const store = createYjsDiagramStore(first.doc);
  store.addNode([], "typed", { x: 300, y: 0 }, {
    nodeType: "service",
    label: "Added after seeding",
  } as never);
  store.destroy();
  await new Promise((r) => setTimeout(r, 50));
  await first.close();

  const second = await openDocument({ docId, initial: makeFile("First") });
  assert(!second.wasSeeded, "a restored document is not seeded again");

  const labels = createYjsDiagramStore(second.doc)
    .getSnapshot()
    .nodes.map((n) => (n.data as { label?: string }).label);
  assert(
    labels.filter((l) => l === "Gateway").length === 1,
    "the seeded content appears exactly once, not twice",
  );
  assert(
    labels.includes("Added after seeding"),
    "and the edit made after seeding survived",
  );
  await second.close();
}

console.log("=== Opening with no initial content ===");
{
  const opened = await openDocument({
    docId: `d-${Math.random().toString(36).slice(2)}`,
  });
  assert(!opened.wasSeeded, "nothing to seed means it reports not seeded");
  assert(
    createYjsDiagramStore(opened.doc).getSnapshot().nodes.length === 0,
    "and the document is empty",
  );
  await opened.close();
}

console.log("=== Closing releases the document ===");
{
  const opened = await openDocument({
    docId: `d-${Math.random().toString(36).slice(2)}`,
    initial: makeFile("Closing"),
    persist: false,
  });

  let notifications = 0;
  opened.stores.diagram.subscribe(() => notifications++);
  await opened.close();

  const other = createYjsDiagramStore(opened.doc);
  other.addNode([], "typed", { x: 0, y: 0 }, {
    nodeType: "service",
    label: "After close",
  } as never);
  assert(
    notifications === 0,
    "a closed document's stores stop reacting - otherwise every document ever " +
      "opened keeps rebuilding snapshots",
  );
  other.destroy();
}

console.log("=== Replacing contents does not merge ===");
{
  const opened = await openDocument({
    docId: `d-${Math.random().toString(36).slice(2)}`,
    initial: makeFile("Original"),
    persist: false,
  });

  const replacement = makeFile("Replacement");
  replacement.nodes = [
    {
      id: "only-node",
      type: "typed",
      position: { x: 0, y: 0 },
      data: { nodeType: "service", label: "Only", parentPath: [] },
    },
  ] as never;

  replaceDocumentContents(opened.doc, replacement);

  const nodes = createYjsDiagramStore(opened.doc).getSnapshot().nodes;
  assert(
    nodes.length === 1 && nodes[0].id === "only-node",
    `loading a file replaces the document rather than unioning with it (got ${nodes.length} nodes)`,
  );
  await opened.close();
}

console.log("=== persist: false keeps runs independent ===");
{
  const docId = `d-${Math.random().toString(36).slice(2)}`;
  const first = await openDocument({
    docId,
    initial: makeFile("Ephemeral"),
    persist: false,
  });
  await first.close();

  const second = await openDocument({ docId, persist: false });
  assert(
    createYjsDiagramStore(second.doc).getSnapshot().nodes.length === 0,
    "nothing carries over, so tests and the perf harness start clean",
  );
  await second.close();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} document bootstrap check(s) failed`);
}
console.log("\nAll document bootstrap checks passed.");
