/**
 * Verification for edge manipulation - endpoint reconnection and
 * waypoints (bends) - across all three DiagramStore implementations.
 *
 * The interesting half of this file is Part 3 onwards. Waypoints are the
 * first list in the diagram schema that several people can be editing
 * DIFFERENT PARTS OF at the same time, which is exactly the case a plain
 * array value silently gets wrong: whoever writes second replaces the
 * whole list and the other person's bend is gone with no conflict, no
 * error, and nothing in the UI to suggest anything happened. These tests
 * are what actually demonstrate the Y.Array<Y.Map> schema avoids that,
 * rather than it just being asserted in a comment.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/collab/edgeManipulation.verify.ts
 */
import * as Y from "yjs";
import { createLocalDiagramStore } from "./diagramStore";
import { createAdapterDiagramStore } from "./adapterDiagramStore";
import { createYjsDiagramStore, seedYjsDiagramDoc } from "./yjsDiagramStore";
import type { DiagramStore } from "./diagramStore";
import type { ArchNodeData, ArchEdgeData, EdgeWaypoint, SubDiagram } from "../domain/types";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

function mkNodeData(label: string): ArchNodeData {
  return { nodeType: "custom", label, description: "", properties: {}, tags: [] };
}

function mkEdgeData(): ArchEdgeData {
  return { edgeType: "blank-solid", label: "", direction: "forward", properties: {} };
}

function wp(id: string, x: number, y: number): EdgeWaypoint {
  return { id, x, y };
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

function forkPeer(sourceDoc: Y.Doc): { doc: Y.Doc; store: DiagramStore } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(sourceDoc));
  return { doc, store: createYjsDiagramStore(doc) };
}

function edgeById(store: DiagramStore, id: string) {
  return store.getSnapshot().edges.find((e) => e.id === id)!;
}

function waypointsOf(store: DiagramStore, edgeId: string): EdgeWaypoint[] {
  return (edgeById(store, edgeId).data as ArchEdgeData).waypoints ?? [];
}

function ids(waypoints: EdgeWaypoint[]): string {
  return waypoints.map((w) => w.id).join(",");
}

/** A tree-adapter store backed by a plain mutable root, so the third
 * implementation can run the same sequences as the other two. */
function makeAdapterStore(): DiagramStore {
  let root: SubDiagram = { nodes: [], edges: [] };
  return createAdapterDiagramStore(
    () => root,
    (updater) => {
      root = updater(root);
    }
  );
}

/** Builds the same two-node, one-edge starting point in any store. */
function seedEdge(store: DiagramStore): { a: string; b: string; c: string; edgeId: string } {
  const a = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("A"));
  const b = store.addNode([], "typed", { x: 300, y: 0 }, mkNodeData("B"));
  const c = store.addNode([], "typed", { x: 300, y: 300 }, mkNodeData("C"));
  const edgeId = store.addEdge([], a, b, mkEdgeData(), "right", "left");
  return { a, b, c, edgeId };
}

// === Part 1: all three implementations behave identically ===
// The local store, the Yjs store and the tree adapter are meant to be
// interchangeable behind the DiagramStore seam. Edge manipulation adds
// five operations to that seam, so the first thing worth proving is that
// it's still one contract and not three dialects of one.
{
  function runSequence(store: DiagramStore) {
    const { c, edgeId } = seedEdge(store);
    store.addEdgeWaypoint(edgeId, 0, wp("w1", 100, 50));
    store.addEdgeWaypoint(edgeId, 1, wp("w2", 200, 50));
    store.addEdgeWaypoint(edgeId, 0, wp("w0", 40, 50));
    store.moveEdgeWaypoint(edgeId, "w2", { x: 250, y: 75 });
    store.removeEdgeWaypoint(edgeId, "w1");
    store.reconnectEdge(edgeId, { source: c, target: store.getSnapshot().nodes[1].id, sourceHandle: "top", targetHandle: "bottom" });
    return { store, edgeId };
  }

  const impls: { name: string; store: DiagramStore }[] = [
    { name: "local", store: createLocalDiagramStore() },
    { name: "yjs", store: createYjsDiagramStore(new Y.Doc()) },
    { name: "adapter", store: makeAdapterStore() },
  ];

  const results = impls.map(({ name, store }) => {
    const { edgeId } = runSequence(store);
    const edge = edgeById(store, edgeId);
    return {
      name,
      shape: JSON.stringify({
        waypoints: waypointsOf(store, edgeId),
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      }),
    };
  });

  assert(
    results.every((r) => r.shape === results[0].shape),
    `all three DiagramStore implementations produce an identical edge after the same sequence of waypoint and reconnect operations - ${results.map((r) => `${r.name}: ${r.shape}`).join(" | ")}`
  );
}

// === Part 2: an edge with no bends has no `waypoints` key at all ===
// Not cosmetic. diagramStore.verify.ts asserts the local and Yjs stores
// emit edge data with the identical SET of keys, and a saved file should
// not start carrying `"waypoints": []` on every edge in a diagram nobody
// has ever bent. The clearing path matters as much as the never-bent
// one: an edge whose bends were all removed has to end up
// indistinguishable from one that never had any.
{
  for (const [name, store] of [
    ["local", createLocalDiagramStore()],
    ["yjs", createYjsDiagramStore(new Y.Doc())],
    ["adapter", makeAdapterStore()],
  ] as const) {
    const { edgeId } = seedEdge(store);

    assert(
      !("waypoints" in (edgeById(store, edgeId).data as object)),
      `${name}: a freshly created edge has no waypoints key present at all, not an empty array`
    );

    store.addEdgeWaypoint(edgeId, 0, wp("w1", 10, 10));
    store.addEdgeWaypoint(edgeId, 1, wp("w2", 20, 20));
    assert(waypointsOf(store, edgeId).length === 2, `${name}: both bends are there once added`);

    store.removeEdgeWaypoint(edgeId, "w1");
    store.removeEdgeWaypoint(edgeId, "w2");
    assert(
      !("waypoints" in (edgeById(store, edgeId).data as object)),
      `${name}: removing the last bend one at a time drops the key entirely, so the edge is indistinguishable from one that was never bent`
    );

    store.addEdgeWaypoint(edgeId, 0, wp("w3", 30, 30));
    store.clearEdgeWaypoints(edgeId);
    assert(
      !("waypoints" in (edgeById(store, edgeId).data as object)),
      `${name}: and clearEdgeWaypoints leaves the same no-key state rather than an empty array`
    );
  }
}

// === Part 3: two people bending the SAME edge at the same time ===
// The headline case. With waypoints stored as a plain array value this
// test fails outright - the second write replaces the whole list and one
// person's bend disappears silently.
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const { edgeId } = seedEdge(storeA);
  const peerB = forkPeer(docA);

  storeA.addEdgeWaypoint(edgeId, 0, wp("from-a", 100, -50));
  peerB.store.addEdgeWaypoint(edgeId, 0, wp("from-b", 200, 50));

  sync(docA, peerB.doc);

  const merged = waypointsOf(storeA, edgeId);
  assert(
    merged.length === 2 && merged.some((w) => w.id === "from-a") && merged.some((w) => w.id === "from-b"),
    "two peers each adding a bend to the same edge concurrently end up with BOTH bends, not just whichever write landed last"
  );
  assert(
    ids(merged) === ids(waypointsOf(peerB.store, edgeId)),
    "and both peers agree on the resulting order of those bends - convergence, not just survival"
  );
}

// === Part 3b: concurrent drags of two DIFFERENT bends on one edge ===
// A drag is a stream of writes, so this is the case that would otherwise
// have each person's cursor fighting the other's for the whole gesture.
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const { edgeId } = seedEdge(storeA);
  storeA.addEdgeWaypoint(edgeId, 0, wp("left", 100, 0));
  storeA.addEdgeWaypoint(edgeId, 1, wp("right", 200, 0));
  const peerB = forkPeer(docA);

  // Several writes each, the way a real pointermove stream arrives.
  for (let i = 1; i <= 5; i++) {
    storeA.moveEdgeWaypoint(edgeId, "left", { x: 100, y: -10 * i });
    peerB.store.moveEdgeWaypoint(edgeId, "right", { x: 200, y: 10 * i });
  }

  sync(docA, peerB.doc);

  const merged = waypointsOf(storeA, edgeId);
  const left = merged.find((w) => w.id === "left")!;
  const right = merged.find((w) => w.id === "right")!;
  assert(
    left.y === -50 && right.y === 50,
    `two peers dragging two different bends on the same edge simultaneously both keep their result (left.y=${left.y}, right.y=${right.y}) - per-waypoint nested maps mean neither drag overwrites the other`
  );
  assert(
    JSON.stringify(merged) === JSON.stringify(waypointsOf(peerB.store, edgeId)),
    "and both peers converge on the identical waypoint list"
  );
}

// === Part 3c: a drag survives a peer inserting a bend BEFORE it ===
// This is what the stable per-waypoint id buys. Index-addressed moves
// would, from this point on, start dragging the wrong bend - silently,
// because index 1 still exists and still accepts writes.
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const { edgeId } = seedEdge(storeA);
  storeA.addEdgeWaypoint(edgeId, 0, wp("dragged", 200, 0));
  const peerB = forkPeer(docA);

  // A drags its bend; B inserts a new one ahead of it, shifting A's from
  // index 0 to index 1 mid-gesture.
  storeA.moveEdgeWaypoint(edgeId, "dragged", { x: 200, y: 40 });
  peerB.store.addEdgeWaypoint(edgeId, 0, wp("inserted", 80, 0));
  sync(docA, peerB.doc);

  // A's drag continues after the merge, still addressing by id.
  storeA.moveEdgeWaypoint(edgeId, "dragged", { x: 200, y: 90 });
  sync(docA, peerB.doc);

  const merged = waypointsOf(storeA, edgeId);
  assert(
    ids(merged) === "inserted,dragged",
    `the peer's inserted bend takes its place ahead of the dragged one (got ${ids(merged)})`
  );
  assert(
    merged.find((w) => w.id === "dragged")!.y === 90 && merged.find((w) => w.id === "inserted")!.y === 0,
    "and the rest of the drag still moves the bend it started on, not the one that shifted into its old index"
  );
}

// === Part 3d: moving a bend a peer already deleted is a no-op ===
// Rather than resurrecting it, or throwing partway through a drag.
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const { edgeId } = seedEdge(storeA);
  storeA.addEdgeWaypoint(edgeId, 0, wp("doomed", 100, 0));
  storeA.addEdgeWaypoint(edgeId, 1, wp("keeper", 200, 0));
  const peerB = forkPeer(docA);

  peerB.store.removeEdgeWaypoint(edgeId, "doomed");
  sync(docA, peerB.doc);
  storeA.moveEdgeWaypoint(edgeId, "doomed", { x: 100, y: 999 });
  sync(docA, peerB.doc);

  assert(
    ids(waypointsOf(storeA, edgeId)) === "keeper" && ids(waypointsOf(peerB.store, edgeId)) === "keeper",
    "continuing to drag a bend another peer just deleted quietly does nothing, rather than resurrecting it or throwing mid-gesture"
  );
}

// === Part 3e: clearing all bends doesn't strand a concurrent insert ===
// Why clearEdgeWaypoints empties the array instead of deleting the key:
// a peer mid-gesture is holding a reference to that array, and deleting
// it would send their remaining writes somewhere nothing can observe.
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const { edgeId } = seedEdge(storeA);
  storeA.addEdgeWaypoint(edgeId, 0, wp("old", 100, 0));
  const peerB = forkPeer(docA);

  storeA.clearEdgeWaypoints(edgeId);
  peerB.store.addEdgeWaypoint(edgeId, 1, wp("new", 250, 30));
  sync(docA, peerB.doc);

  const a = waypointsOf(storeA, edgeId);
  const b = waypointsOf(peerB.store, edgeId);
  assert(
    ids(a) === "new" && ids(b) === "new",
    `one peer clearing every bend while another adds one leaves exactly the newly added bend on both peers (got ${ids(a)} / ${ids(b)}) - the clear removes what existed, and the concurrent insert isn't lost into a detached array`
  );
}

// === Part 4: concurrent endpoint reconnection ===
// Endpoints are four fields that have to move as one. Whichever peer
// wins, nobody should end up with A's new source spliced onto B's new
// target - an edge that was never drawn by anyone.
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const { a, b, c, edgeId } = seedEdge(storeA);
  const peerB = forkPeer(docA);

  storeA.reconnectEdge(edgeId, { source: a, target: c, sourceHandle: "bottom", targetHandle: "top" });
  peerB.store.reconnectEdge(edgeId, { source: c, target: b, sourceHandle: "right", targetHandle: "left" });

  sync(docA, peerB.doc);

  const edgeA = edgeById(storeA, edgeId);
  const edgeB = edgeById(peerB.store, edgeId);
  assert(
    edgeA.source === edgeB.source &&
      edgeA.target === edgeB.target &&
      edgeA.sourceHandle === edgeB.sourceHandle &&
      edgeA.targetHandle === edgeB.targetHandle,
    "two peers reconnecting the same edge at once converge on identical endpoints"
  );
  const isAsWrittenByA = edgeA.source === a && edgeA.target === c;
  const isAsWrittenByB = edgeA.source === c && edgeA.target === b;
  assert(
    isAsWrittenByA || isAsWrittenByB,
    `the surviving edge is one of the two edges someone actually drew (got ${edgeA.source} -> ${edgeA.target}), not a splice of one peer's source onto the other's target`
  );
  assert(
    (isAsWrittenByA && edgeA.sourceHandle === "bottom" && edgeA.targetHandle === "top") ||
      (isAsWrittenByB && edgeA.sourceHandle === "right" && edgeA.targetHandle === "left"),
    "and its handles came from the same peer as its nodes did, rather than being mixed between the two"
  );
}

// === Part 5: bends survive starting and ending a collaborative session ===
// Seeding has to rebuild waypoints as real nested shared types. If it
// set them as the plain array they arrive as, an edge bent BEFORE the
// session started would be the one edge in the whole document that
// doesn't merge properly - and nothing else would reveal that.
{
  const local = createLocalDiagramStore();
  const { edgeId } = seedEdge(local);
  local.addEdgeWaypoint(edgeId, 0, wp("pre-existing", 120, 60));
  local.addEdgeWaypoint(edgeId, 1, wp("also-pre-existing", 220, 60));

  // Sessions start from the recursive tree shape, so go through it the
  // way App.tsx does rather than handing the flat snapshot over directly.
  const snapshot = local.getSnapshot();
  const root: SubDiagram = {
    nodes: snapshot.nodes.map((n) => ({ ...n, data: { ...n.data } })),
    edges: snapshot.edges.map((e) => ({ ...e, data: { ...(e.data as ArchEdgeData) } })),
  };

  const docA = new Y.Doc();
  seedYjsDiagramDoc(docA, root);
  const storeA = createYjsDiagramStore(docA);

  assert(
    ids(waypointsOf(storeA, edgeId)) === "pre-existing,also-pre-existing",
    "bends made before a session starts are carried into the shared document in the right order"
  );

  const peerB = forkPeer(docA);
  peerB.store.moveEdgeWaypoint(edgeId, "pre-existing", { x: 120, y: 500 });
  storeA.moveEdgeWaypoint(edgeId, "also-pre-existing", { x: 220, y: -500 });
  sync(docA, peerB.doc);

  const merged = waypointsOf(storeA, edgeId);
  assert(
    merged[0].y === 500 && merged[1].y === -500,
    "and once in the session they merge per-bend exactly like ones created during it - proving seeding rebuilt them as nested shared types rather than setting a plain array"
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
// scripts/run-tests.ts decides pass/fail from the process exit status, so
// a failed assertion has to actually set one - printing FAIL and exiting
// 0 would report the suite as passing. Reached through globalThis
// because tsconfig.app.json doesn't include node's type definitions.
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
