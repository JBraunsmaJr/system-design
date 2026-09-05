/**
 * Standalone verification for the DiagramStore seam - same purpose and
 * rationale as the other stores' verify scripts, but this one is the
 * highest-stakes: it's proving the flattened-tree schema itself actually
 * works, not just that operations merge correctly on top of an
 * already-proven shape. Run with:
 *
 *   npx tsx src/collab/diagramStore.verify.ts
 */
import * as Y from "yjs";
import { createLocalDiagramStore, getNodesAtPath, getEdgesAtPath } from "./diagramStore";
import { createYjsDiagramStore } from "./yjsDiagramStore";
import type { DiagramStore } from "./diagramStore";
import type { ArchNodeData, ArchEdgeData } from "../domain/types";

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

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

function forkPeer(sourceDoc: Y.Doc): { doc: Y.Doc; store: DiagramStore } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(sourceDoc));
  return { doc, store: createYjsDiagramStore(doc) };
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

// === Part 1: conformance - same operations, structurally identical results ===
{
  function runSequence(store: DiagramStore) {
    const rootId = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Root Service"));
    store.markSubDiagramOpened(rootId);
    const childId = store.addNode([rootId], "typed", { x: 10, y: 10 }, mkNodeData("Nested Worker"));
    store.updateNode(childId, { description: "Handles background jobs" });
    store.addEdge([], rootId, rootId, mkEdgeData()); // trivial self-edge just to exercise the path
    return store.getSnapshot();
  }

  const localSnap = runSequence(createLocalDiagramStore());
  const yjsSnap = runSequence(createYjsDiagramStore(new Y.Doc()));

  function stripIds(snap: ReturnType<DiagramStore["getSnapshot"]>) {
    return {
      nodes: snap.nodes
        .map((n) => {
          const parentPath = (n.data as ArchNodeData & { parentPath?: string[] }).parentPath;
          return { type: n.type, position: n.position, data: { ...n.data, parentPath: parentPath?.length ?? 0 } };
        })
        .sort((a, b) => (a.data.label > b.data.label ? 1 : -1)),
      edgeCount: snap.edges.length,
    };
  }

  assert(
    canonicalJSON(stripIds(localSnap)) === canonicalJSON(stripIds(yjsSnap)),
    "local and Yjs stores produce structurally identical results (node data, positions, parentPath, edge count) after the same sequence of operations across two tree levels - the Yjs implementation is a faithful drop-in for single-user use"
  );
}

// === Part 2: the actual point - flattening correctly reconstructs each tree level ===
{
  const store = createLocalDiagramStore();
  const rootA = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Service A"));
  const rootB = store.addNode([], "typed", { x: 100, y: 0 }, mkNodeData("Service B"));
  store.markSubDiagramOpened(rootA);
  const childOfA1 = store.addNode([rootA], "typed", { x: 0, y: 0 }, mkNodeData("A's Worker"));
  const childOfA2 = store.addNode([rootA], "typed", { x: 50, y: 0 }, mkNodeData("A's Cache"));
  store.markSubDiagramOpened(childOfA1);
  const grandchild = store.addNode([rootA, childOfA1], "typed", { x: 0, y: 0 }, mkNodeData("Deeply Nested Job"));
  store.addEdge([], rootA, rootB, mkEdgeData());
  store.addEdge([rootA], childOfA1, childOfA2, mkEdgeData());

  const { nodes, edges } = store.getSnapshot();

  const atRoot = getNodesAtPath(nodes, []);
  assert(atRoot.length === 2 && atRoot.every((n) => [rootA, rootB].includes(n.id)), "getNodesAtPath([]) returns exactly the two root-level nodes, none of the nested ones");

  const atRootA = getNodesAtPath(nodes, [rootA]);
  assert(atRootA.length === 2 && atRootA.every((n) => [childOfA1, childOfA2].includes(n.id)), "getNodesAtPath([rootA]) returns exactly the two nodes one level inside rootA's sub-diagram, not the root-level nodes or the grandchild two levels down");

  const atChildOfA1 = getNodesAtPath(nodes, [rootA, childOfA1]);
  assert(atChildOfA1.length === 1 && atChildOfA1[0].id === grandchild, "getNodesAtPath([rootA, childOfA1]) correctly reconstructs the THIRD level of nesting - just the one grandchild node, proving the flattened model handles more than one level of depth, not just root+1");

  const rootEdges = getEdgesAtPath(edges, []);
  assert(rootEdges.length === 1 && rootEdges[0].source === rootA && rootEdges[0].target === rootB, "getEdgesAtPath([]) returns exactly the one root-level edge");

  const nestedEdges = getEdgesAtPath(edges, [rootA]);
  assert(nestedEdges.length === 1 && nestedEdges[0].source === childOfA1, "getEdgesAtPath([rootA]) returns exactly the one edge that belongs one level inside rootA");
}

// === Part 3a: concurrent field edits on the SAME node - position vs label. ===
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const nodeId = storeA.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Original"));
  const peerB = forkPeer(docA);

  storeA.updatePosition(nodeId, { x: 500, y: 500 });
  peerB.store.updateNode(nodeId, { label: "Renamed by B" });

  sync(docA, peerB.doc);

  const nodeA = storeA.getSnapshot().nodes.find((n) => n.id === nodeId)!;
  const nodeB = peerB.store.getSnapshot().nodes.find((n) => n.id === nodeId)!;
  assert(nodeA.position.x === 500 && nodeA.data.label === "Renamed by B", "peer A's merged view has BOTH concurrent edits - A's position change and B's label change both survived");
  assert(nodeB.position.x === 500 && nodeB.data.label === "Renamed by B", "peer B's merged view matches peer A's exactly");
}

// === Part 3b: concurrent creation at DIFFERENT tree levels by different peers, both correctly filtered afterward. ===
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const rootId = storeA.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Root"));
  const peerB = forkPeer(docA);

  storeA.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("Root Sibling"));
  const nestedFromB = peerB.store.addNode([rootId], "typed", { x: 2, y: 2 }, mkNodeData("Nested By B"));

  sync(docA, peerB.doc);

  const allNodesA = storeA.getSnapshot().nodes;
  assert(getNodesAtPath(allNodesA, []).length === 2, "peer A sees both root-level nodes (original + the one A itself added) after sync");
  assert(getNodesAtPath(allNodesA, [rootId]).length === 1 && getNodesAtPath(allNodesA, [rootId])[0].id === nestedFromB, "peer A ALSO sees the node B concurrently created one level deeper, correctly filtered to that level and not mixed in with the root level");
  const allNodesB = peerB.store.getSnapshot().nodes;
  assert(JSON.stringify(allNodesA.map((n) => n.id).sort()) === JSON.stringify(allNodesB.map((n) => n.id).sort()), "both peers converge to the identical set of nodes across both levels");
}

// === Part 3c: delete cascade across MULTIPLE levels of nesting - the core new behavior the flattened model needs that the old nested-object model got for free. ===
{
  const doc = new Y.Doc();
  const store = createYjsDiagramStore(doc);
  const rootId = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Root"));
  const otherRootId = store.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("Unrelated Sibling"));
  const level1 = store.addNode([rootId], "typed", { x: 0, y: 0 }, mkNodeData("Level 1"));
  const level2 = store.addNode([rootId, level1], "typed", { x: 0, y: 0 }, mkNodeData("Level 2"));
  const level3 = store.addNode([rootId, level1, level2], "typed", { x: 0, y: 0 }, mkNodeData("Level 3"));
  store.addEdge([rootId, level1, level2], level2, level3, mkEdgeData());

  store.deleteNode(rootId);

  const { nodes, edges } = store.getSnapshot();
  assert(nodes.length === 1 && nodes[0].id === otherRootId, "deleting the root of a three-level-deep sub-diagram tree removes the root AND every descendant at every depth (level1, level2, level3) - only the genuinely unrelated sibling node survives");
  assert(edges.length === 0, "the deeply-nested edge (between level2 and level3, three levels down) is also removed as part of the cascade, since both endpoints were deleted");
}

// === Part 3d: an edge untouched by a deletion elsewhere correctly survives ===
{
  const doc = new Y.Doc();
  const store = createYjsDiagramStore(doc);
  const rootId = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Root"));
  const siblingA = store.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("Sibling A"));
  const siblingB = store.addNode([], "typed", { x: 2, y: 2 }, mkNodeData("Sibling B"));
  store.addNode([rootId], "typed", { x: 0, y: 0 }, mkNodeData("Level 1"));
  store.addEdge([], siblingA, siblingB, mkEdgeData()); // touches neither rootId nor its nested child

  store.deleteNode(rootId);

  const { nodes, edges } = store.getSnapshot();
  assert(nodes.length === 2 && nodes.every((n) => [siblingA, siblingB].includes(n.id)), "deleting root removes root and its nested level1 child, leaving the two genuinely unrelated siblings");
  assert(edges.length === 1 && edges[0].source === siblingA && edges[0].target === siblingB, "an edge that doesn't touch the deleted node or any of its descendants correctly survives the cascade");
}

// === Part 3e: delete-vs-edit race on a node. ===
{
  const docA = new Y.Doc();
  const storeA = createYjsDiagramStore(docA);
  const nodeId = storeA.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Doomed"));
  const peerB = forkPeer(docA);

  storeA.deleteNode(nodeId);
  peerB.store.updateNode(nodeId, { label: "B didn't know it was deleted" });

  sync(docA, peerB.doc);

  assert(storeA.getSnapshot().nodes.find((n) => n.id === nodeId) === undefined, "the delete wins on peer A - not resurrected by B's concurrent edit");
  assert(peerB.store.getSnapshot().nodes.find((n) => n.id === nodeId) === undefined, "the delete wins on peer B too - both converge to the same outcome");
}

// === Part 4: markSubDiagramOpened - the "opened but empty" distinction ===
{
  const store = createLocalDiagramStore();
  const neverOpened = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Never Opened"));
  const openedButEmpty = store.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("Opened But Empty"));
  store.markSubDiagramOpened(openedButEmpty);

  const { nodes } = store.getSnapshot();
  const neverOpenedNode = nodes.find((n) => n.id === neverOpened)!;
  const openedNode = nodes.find((n) => n.id === openedButEmpty)!;
  assert(!(neverOpenedNode.data as ArchNodeData & { hasOpenedSubDiagram?: boolean }).hasOpenedSubDiagram, "a node that's never been drilled into has no hasOpenedSubDiagram flag set");
  assert((openedNode.data as ArchNodeData & { hasOpenedSubDiagram?: boolean }).hasOpenedSubDiagram === true, "a node explicitly marked as opened reports that, even though it has ZERO children in the flat space - this is exactly the distinction that can't be derived from 'does anything reference this as a parent', confirmed working");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
