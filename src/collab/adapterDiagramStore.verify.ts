/**
 * Standalone verification for createAdapterDiagramStore - proving the
 * bridge between the flat DiagramStore interface and the app's actual
 * recursive tree representation works correctly. Run with:
 *
 *   npx tsx src/collab/adapterDiagramStore.verify.ts
 */
import { createLocalDiagramStore, getNodesAtPath, getEdgesAtPath, hasSubDiagram } from "./diagramStore";
import { createAdapterDiagramStore } from "./adapterDiagramStore";
import type { DiagramStore } from "./diagramStore";
import type { ArchNodeData, ArchEdgeData, SubDiagram } from "../domain/types";

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

function makeAdapterStore(): { store: DiagramStore; getRoot: () => SubDiagram } {
  let root: SubDiagram = { nodes: [], edges: [] };
  const store = createAdapterDiagramStore(
    () => root,
    (updater) => {
      root = updater(root);
    }
  );
  return { store, getRoot: () => root };
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

// === Part 1: conformance against the local (flat-native) store ===
{
  function runSequence(store: DiagramStore) {
    const rootId = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Root Service"));
    const childId = store.addNode([rootId], "typed", { x: 10, y: 10 }, mkNodeData("Nested Worker"));
    store.updateNode(childId, { description: "Handles background jobs" });
    store.addEdge([], rootId, rootId, mkEdgeData());
    return store.getSnapshot();
  }

  const localSnap = runSequence(createLocalDiagramStore());
  const adapterSnap = runSequence(makeAdapterStore().store);

  function stripIds(snap: ReturnType<DiagramStore["getSnapshot"]>) {
    return {
      nodes: snap.nodes
        .map((n) => {
          const extra = n.data as ArchNodeData & { parentPath?: string[] };
          return {
            type: n.type,
            position: n.position,
            data: { ...n.data, parentPath: extra.parentPath?.length ?? 0 },
          };
        })
        .sort((a, b) => (a.data.label > b.data.label ? 1 : -1)),
      edgeCount: snap.edges.length,
    };
  }

  assert(
    canonicalJSON(stripIds(localSnap)) === canonicalJSON(stripIds(adapterSnap)),
    "the tree-backed adapter produces structurally identical results to the flat-native local store after the same sequence of operations - the two representations agree despite being fundamentally different internally"
  );
}

// === Part 2: flattening correctly reconstructs each tree level (same guarantee as the Yjs store, now for the adapter) ===
{
  const { store } = makeAdapterStore();
  const rootA = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Service A"));
  const rootB = store.addNode([], "typed", { x: 100, y: 0 }, mkNodeData("Service B"));
  const childOfA1 = store.addNode([rootA], "typed", { x: 0, y: 0 }, mkNodeData("A's Worker"));
  const childOfA2 = store.addNode([rootA], "typed", { x: 50, y: 0 }, mkNodeData("A's Cache"));
  const grandchild = store.addNode([rootA, childOfA1], "typed", { x: 0, y: 0 }, mkNodeData("Deeply Nested Job"));
  store.addEdge([], rootA, rootB, mkEdgeData());
  store.addEdge([rootA], childOfA1, childOfA2, mkEdgeData());

  const { nodes, edges } = store.getSnapshot();

  const atRoot = getNodesAtPath(nodes, []);
  assert(atRoot.length === 2 && atRoot.every((n) => [rootA, rootB].includes(n.id)), "getNodesAtPath([]) returns exactly the two root-level nodes");

  const atRootA = getNodesAtPath(nodes, [rootA]);
  assert(atRootA.length === 2 && atRootA.every((n) => [childOfA1, childOfA2].includes(n.id)), "getNodesAtPath([rootA]) returns exactly the two nodes one level inside rootA");

  const atChildOfA1 = getNodesAtPath(nodes, [rootA, childOfA1]);
  assert(atChildOfA1.length === 1 && atChildOfA1[0].id === grandchild, "getNodesAtPath([rootA, childOfA1]) correctly reconstructs the THIRD level of nesting through the real recursive tree, not just root+1");

  const rootEdges = getEdgesAtPath(edges, []);
  assert(rootEdges.length === 1 && rootEdges[0].source === rootA && rootEdges[0].target === rootB, "getEdgesAtPath([]) returns exactly the one root-level edge");

  const nestedEdges = getEdgesAtPath(edges, [rootA]);
  assert(nestedEdges.length === 1 && nestedEdges[0].source === childOfA1, "getEdgesAtPath([rootA]) returns exactly the one edge that belongs one level inside rootA");
}

// === Part 3: updating a deeply-nested node finds and patches the right level of the real tree ===
{
  const { store, getRoot } = makeAdapterStore();
  const rootId = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Root"));
  const level1 = store.addNode([rootId], "typed", { x: 0, y: 0 }, mkNodeData("Level 1"));
  const level2 = store.addNode([rootId, level1], "typed", { x: 0, y: 0 }, mkNodeData("Level 2"));

  store.updateNode(level2, { description: "Updated at depth 2" });
  store.updatePosition(level2, { x: 999, y: 999 });

  const snapshot = store.getSnapshot();
  const updated = snapshot.nodes.find((n) => n.id === level2)!;
  assert(updated.data.description === "Updated at depth 2", "updateNode correctly finds and patches a node two levels deep in the real tree");
  assert(updated.position.x === 999, "updatePosition correctly finds and patches a node two levels deep");

  // Confirm this landed in the ACTUAL tree structure, not just the flattened view - the real proof this isn't just patching a flat copy.
  const actualRoot = getRoot();
  const actualLevel2 = actualRoot.nodes[0].data.subDiagram!.nodes[0].data.subDiagram!.nodes[0];
  assert(actualLevel2.data.description === "Updated at depth 2", "the update is reflected in the ACTUAL nested subDiagram structure, confirming this isn't just patching a flat snapshot that gets discarded");
}

// === Part 4: delete cascade across multiple levels - the tree gets this for free by construction, verified it actually does ===
{
  const { store } = makeAdapterStore();
  const rootId = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Root"));
  const otherRootId = store.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("Unrelated Sibling"));
  const level1 = store.addNode([rootId], "typed", { x: 0, y: 0 }, mkNodeData("Level 1"));
  const level2 = store.addNode([rootId, level1], "typed", { x: 0, y: 0 }, mkNodeData("Level 2"));
  store.addEdge([rootId], level1, level1, mkEdgeData()); // an edge nested one level in, inside what's about to be deleted

  store.deleteNode(rootId);

  const { nodes, edges } = store.getSnapshot();
  assert(nodes.length === 1 && nodes[0].id === otherRootId, "deleting the root of a two-level-deep sub-diagram removes the root and every descendant (level1, level2), leaving only the genuinely unrelated sibling");
  assert(edges.length === 0, "the edge nested inside the deleted subtree is gone too, since removing the node from its own level takes its whole nested subDiagram (edges included) along with it automatically");
  void level2;
}

// === Part 5: an edge untouched by a deletion elsewhere correctly survives ===
{
  const { store } = makeAdapterStore();
  const rootId = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Root"));
  const siblingA = store.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("Sibling A"));
  const siblingB = store.addNode([], "typed", { x: 2, y: 2 }, mkNodeData("Sibling B"));
  store.addNode([rootId], "typed", { x: 0, y: 0 }, mkNodeData("Level 1"));
  store.addEdge([], siblingA, siblingB, mkEdgeData());

  store.deleteNode(rootId);

  const { nodes, edges } = store.getSnapshot();
  assert(nodes.length === 2 && nodes.every((n) => [siblingA, siblingB].includes(n.id)), "deleting root removes root and its nested child, leaving the two genuinely unrelated siblings");
  assert(edges.length === 1 && edges[0].source === siblingA && edges[0].target === siblingB, "an edge that doesn't touch the deleted node or any of its descendants correctly survives");
}

// === Part 6: hasSubDiagram against the tree-backed adapter - correctly matches the real app's own definition (at least one child) ===
{
  const { store } = makeAdapterStore();
  const emptyNode = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("No Children"));
  const populatedNode = store.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("Has Children"));
  store.addNode([populatedNode], "typed", { x: 0, y: 0 }, mkNodeData("A Child"));

  const { nodes } = store.getSnapshot();
  assert(!hasSubDiagram(nodes, [], emptyNode), "a node with no children at all correctly reports no sub-diagram, even via the tree-backed adapter");
  assert(hasSubDiagram(nodes, [], populatedNode), "a node with at least one child correctly reports having a sub-diagram, matching the real app's own findLinkedNodes definition - not a separate flag that could drift out of sync with the actual tree");
}

// === Part 7: group containment (parentId) and dimensions are independent of tree-level nesting ===
{
  const { store } = makeAdapterStore();
  const groupId = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("Group"));
  const childId = store.addNode([], "typed", { x: 10, y: 10 }, mkNodeData("Grouped Node"));

  store.updateParentId(childId, groupId, { x: 5, y: 5 });
  store.updateDimensions(groupId, 400, 300);

  const { nodes } = store.getSnapshot();
  const child = nodes.find((n) => n.id === childId)!;
  const group = nodes.find((n) => n.id === groupId)!;
  assert(child.parentId === groupId && child.position.x === 5, "updateParentId correctly sets both parentId and the new (relative) position");
  assert(group.width === 400 && group.height === 300, "updateDimensions correctly sets width/height");
  assert(
    (child.data as ArchNodeData & { parentPath?: string[] }).parentPath?.length === 0 &&
      (group.data as ArchNodeData & { parentPath?: string[] }).parentPath?.length === 0,
    "both nodes remain at the same TREE level (root) despite one being visually grouped inside the other - parentId (same-level visual containment) and parentPath (tree-level nesting) are correctly independent of each other"
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
