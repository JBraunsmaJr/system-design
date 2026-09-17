/**
 * WS1-R8 / migration plan hazard 2.4 - snapshot identity.
 *
 * React Flow keeps its internal node only when the object it is handed is
 * identical to last time, so a store that mints fresh objects for everything
 * on every change re-renders every node on every change. These checks pin
 * that a change rebuilds exactly the entries it touched, whether it came from
 * a local edit or a remote update, and that one transaction produces one
 * notification.
 */
import * as Y from "yjs";
import { createYjsDiagramStore, seedYjsDiagramDoc } from "./yjsDiagramStore.ts";
import type { SubDiagram } from "../domain/types.ts";

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
  nodes: Array.from({ length: 30 }, (_, i) => ({
    id: `n${i}`,
    type: "typed",
    position: { x: i * 10, y: 0 },
    data: {
      nodeType: "service",
      label: `Node ${i}`,
      ...(i === 0
        ? { subDiagram: { nodes: [{ id: "child", type: "typed", position: { x: 0, y: 0 }, data: { nodeType: "service", label: "Child" } }], edges: [] } }
        : {}),
    },
  })),
  edges: Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    source: `n${i}`,
    target: `n${i + 1}`,
    type: "typed",
    data: { edgeType: "sync", waypoints: i === 3 ? [{ id: "wp", x: 1, y: 1 }] : undefined },
  })),
} as unknown as SubDiagram;

type Snap = ReturnType<ReturnType<typeof createYjsDiagramStore>["getSnapshot"]>;

/** Ids whose object identity differs between two snapshots. */
function changedIds(before: Snap, after: Snap) {
  const diff = <T extends { id: string }>(a: T[], b: T[]) => {
    const prev = new Map(a.map((x) => [x.id, x]));
    return b.filter((x) => prev.get(x.id) !== x).map((x) => x.id);
  };
  return { nodes: diff(before.nodes, after.nodes), edges: diff(before.edges, after.edges) };
}

const doc = new Y.Doc();
seedYjsDiagramDoc(doc, root);
const store = createYjsDiagramStore(doc);
let notifications = 0;
store.subscribe(() => notifications++);

function step(name: string, edit: () => void, expected: { nodes: string[]; edges: string[] }) {
  const before = store.getSnapshot();
  notifications = 0;
  edit();
  const after = store.getSnapshot();
  const got = changedIds(before, after);
  assert(
    JSON.stringify(got.nodes.sort()) === JSON.stringify([...expected.nodes].sort()) &&
      JSON.stringify(got.edges.sort()) === JSON.stringify([...expected.edges].sort()),
    `${name}: rebuilt nodes ${JSON.stringify(got.nodes)} edges ${JSON.stringify(got.edges)}`
  );
  assert(notifications === 1, `${name}: one notification (got ${notifications})`);
}

console.log("=== Local edits rebuild only what they touch ===");
assert(store.getSnapshot() === store.getSnapshot(), "the snapshot is stable while nothing changes");
step("move one node", () => store.updatePosition("n5", { x: 999, y: 0 }), { nodes: ["n5"], edges: [] });
step("edit one node's data", () => store.updateNode("n7", { label: "Renamed" }), { nodes: ["n7"], edges: [] });
step("resize one node", () => store.updateDimensions("n8", 120, 40), { nodes: ["n8"], edges: [] });
step("move one waypoint", () => store.moveEdgeWaypoint("e3", "wp", { x: 5, y: 5 }), { nodes: [], edges: ["e3"] });
step("add a waypoint", () => store.addEdgeWaypoint("e4", 0, { id: "wp2", x: 2, y: 2 }), { nodes: [], edges: ["e4"] });
step("edit one edge", () => store.updateEdge("e9", { label: "calls" }), { nodes: [], edges: ["e9"] });
step("reconnect one edge", () => store.reconnectEdge("e10", { source: "n10", target: "n20" }), { nodes: [], edges: ["e10"] });

{
  const before = store.getSnapshot();
  const added = store.addNode([], "typed", { x: 0, y: 0 }, { nodeType: "service", label: "New" } as never);
  const got = changedIds(before, store.getSnapshot());
  assert(JSON.stringify(got.nodes) === JSON.stringify([added]) && got.edges.length === 0, "adding a node leaves every existing object untouched");
}
{
  const before = store.getSnapshot();
  store.deleteNode("n0"); // cascades to its child and to e0
  const after = store.getSnapshot();
  const ids = after.nodes.map((n) => n.id);
  assert(!ids.includes("n0") && !ids.includes("child") && !after.edges.some((e) => e.id === "e0"), "a cascading delete removes the node, its descendants and its edges");
  const got = changedIds(before, after);
  assert(got.nodes.length === 0 && got.edges.length === 0, "and every survivor keeps its identity");
}

console.log("\n=== Remote updates rebuild only what they touch ===");
{
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const peerStore = createYjsDiagramStore(peer);
  const before = store.getSnapshot();
  notifications = 0;
  const sv = Y.encodeStateVector(doc);
  peerStore.updatePosition("n12", { x: 1, y: 2 });
  peerStore.updateEdge("e15", { label: "remote" });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, sv), "remote");
  const got = changedIds(before, store.getSnapshot());
  assert(
    JSON.stringify(got.nodes) === JSON.stringify(["n12"]) && JSON.stringify(got.edges) === JSON.stringify(["e15"]),
    `a remote update rebuilds only n12 and e15 (got ${JSON.stringify(got)})`
  );
  assert(notifications === 1, `one notification for the whole remote update (got ${notifications})`);
  assert(store.getSnapshot().nodes.find((n) => n.id === "n12")?.position.x === 1, "and carries the remote value");
  peerStore.destroy();
}

console.log("\n=== Whole-document writes and teardown ===");
{
  const before = store.getSnapshot();
  store.replaceAll(root);
  const after = store.getSnapshot();
  assert(after.nodes.length === 31 && after.edges.length === 20, "replaceAll installs the full diagram again");
  assert(after.nodes.every((n) => !before.nodes.includes(n)), "and every entry is rebuilt, since every shared type is new");
  store.destroy();
  notifications = 0;
  const frozen = store.getSnapshot();
  doc.transact(() => doc.getMap<Y.Map<unknown>>("nodes").get("n1")?.set("position", { x: -1, y: -1 }));
  assert(notifications === 0 && store.getSnapshot() === frozen, "a destroyed store neither rebuilds nor notifies");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll snapshot-sharing checks passed.");
}
