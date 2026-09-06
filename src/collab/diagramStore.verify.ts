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
import { createLocalDiagramStore, getNodesAtPath, getEdgesAtPath, hasSubDiagram, flattenSubDiagramTree, unflattenToSubDiagram } from "./diagramStore";
import { createYjsDiagramStore, seedYjsDiagramDoc } from "./yjsDiagramStore";
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
  const childOfA1 = store.addNode([rootA], "typed", { x: 0, y: 0 }, mkNodeData("A's Worker"));
  const childOfA2 = store.addNode([rootA], "typed", { x: 50, y: 0 }, mkNodeData("A's Cache"));
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

// === Part 4: hasSubDiagram - correctly matches the real app's own definition (at least one child), not a separate "opened" flag ===
{
  const store = createLocalDiagramStore();
  const emptyNode = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("No Children"));
  const populatedNode = store.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("Has Children"));
  store.addNode([populatedNode], "typed", { x: 0, y: 0 }, mkNodeData("A Child"));

  const { nodes } = store.getSnapshot();
  assert(!hasSubDiagram(nodes, [], emptyNode), "a node with no children at all correctly reports no sub-diagram");
  assert(hasSubDiagram(nodes, [], populatedNode), "a node with at least one child correctly reports having a sub-diagram - matching the real app's own existing findLinkedNodes definition exactly, not a separate invented flag");
}

// === Part 5: sourceHandle/targetHandle are preserved - real, meaningful data for nodes with multiple named handles (discovered during actual UI wiring, not something addEdge can afford to silently drop) ===
{
  function runSequence(store: DiagramStore) {
    const a = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("A"));
    const b = store.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("B"));
    store.addEdge([], a, b, mkEdgeData(), "source-right", "target-left");
    return store.getSnapshot().edges[0];
  }

  const localEdge = runSequence(createLocalDiagramStore());
  const yjsEdge = runSequence(createYjsDiagramStore(new Y.Doc()));

  assert(localEdge.sourceHandle === "source-right" && localEdge.targetHandle === "target-left", "the local store correctly preserves which specific named handle a connection was made from/to");
  assert(yjsEdge.sourceHandle === "source-right" && yjsEdge.targetHandle === "target-left", "the Yjs store correctly preserves the same, round-tripping through real yjs");

  // An edge created without explicit handles (the common case - most
  // nodes only have one, default handle) shouldn't have these fields
  // forced to some placeholder value.
  const plainStore = createLocalDiagramStore();
  const c = plainStore.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("C"));
  const d = plainStore.addNode([], "typed", { x: 1, y: 1 }, mkNodeData("D"));
  plainStore.addEdge([], c, d, mkEdgeData());
  const plainEdge = plainStore.getSnapshot().edges[0];
  assert(plainEdge.sourceHandle === undefined && plainEdge.targetHandle === undefined, "an edge created without explicit handles has no sourceHandle/targetHandle forced onto it");
}

// === Part 6: flattenSubDiagramTree / unflattenToSubDiagram round-trip - what leaveSession relies on to convert a session's final flat state back into the app's own recursive tree without losing anything ===
{
  // A realistic multi-level tree, built directly in the recursive shape
  // the real app actually uses (not via the flat store), including a
  // node with a populated sub-diagram, a group-contained child (parentId,
  // a SAME-level concern that flattening/unflattening must leave alone),
  // and a node with sourceHandle/targetHandle set on one of its edges.
  const originalTree: SubDiagram = {
    nodes: [
      {
        id: "root-a",
        type: "typed",
        position: { x: 0, y: 0 },
        data: {
          nodeType: "custom",
          label: "Root A",
          description: "Has a populated sub-diagram",
          properties: {},
          tags: [],
          subDiagram: {
            nodes: [
              { id: "child-1", type: "typed", position: { x: 0, y: 0 }, data: mkNodeData("Child One") },
              { id: "child-2", type: "typed", position: { x: 1, y: 1 }, data: mkNodeData("Child Two") },
            ],
            edges: [{ id: "child-edge", source: "child-1", target: "child-2", type: "typed", data: mkEdgeData() }],
          },
        },
      },
      { id: "root-group", type: "group", position: { x: 5, y: 5 }, width: 200, height: 150, data: mkNodeData("A Group") },
      {
        id: "root-b",
        type: "typed",
        position: { x: 10, y: 10 },
        parentId: "root-group",
        data: mkNodeData("Grouped Root Node"),
      },
    ],
    edges: [
      {
        id: "root-edge",
        source: "root-a",
        target: "root-b",
        sourceHandle: "source-right",
        targetHandle: "target-left",
        type: "typed",
        data: mkEdgeData(),
      },
    ],
  };

  const { nodes, edges } = flattenSubDiagramTree(originalTree);
  const rebuiltTree = unflattenToSubDiagram(nodes, edges);

  assert(
    canonicalJSON(originalTree) === canonicalJSON(rebuiltTree),
    "a multi-level tree (with a populated sub-diagram, a group-contained child, and an edge with named handles) survives flatten-then-unflatten as an EXACT structural match - nothing lost, nothing rearranged"
  );

  // Confirm this isn't a vacuous pass - the flat intermediate form really
  // did tag things with parentPath, and unflattening genuinely removed
  // it again rather than the round-trip just happening to look right by
  // coincidence.
  const flatChild = nodes.find((n) => n.id === "child-1")!;
  assert(
    JSON.stringify((flatChild.data as ArchNodeData & { parentPath?: string[] }).parentPath) === JSON.stringify(["root-a"]),
    "the flat intermediate form genuinely tags a nested node with its real parentPath"
  );
  const rebuiltChild = rebuiltTree.nodes[0].data.subDiagram!.nodes.find((n) => n.id === "child-1")!;
  assert(
    !("parentPath" in rebuiltChild.data),
    "unflattening genuinely removes parentPath again, rather than the round-trip coincidentally matching some other way"
  );

  // === Part 7: seedYjsDiagramDoc - starting a session must preserve an existing diagram exactly, including nested content, group containment, and edge handles ===
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, originalTree);
  const seededStore = createYjsDiagramStore(doc);
  const seededSnapshot = seededStore.getSnapshot();
  const rebuiltFromSeed = unflattenToSubDiagram(seededSnapshot.nodes, seededSnapshot.edges);

  assert(
    canonicalJSON(originalTree) === canonicalJSON(rebuiltFromSeed),
    "seeding a fresh Y.Doc from an existing tree, then reading it back through the real Yjs store and unflattening the result, reproduces the ORIGINAL tree exactly - including the nested sub-diagram, the group-contained child's parentId, and the edge's named handles - nothing lost in either direction of the round trip"
  );
}

// === Part 8: local and Yjs stores produce data objects with the EXACT SAME SET OF KEYS, not just equal JSON - a real bug the JSON-based conformance check in Part 1 could never have caught, since JSON.stringify silently drops undefined-valued keys ===
// The real bug this specifically catches: the Yjs store's read side used
// to unconditionally assign every field from NODE_DATA_FIELDS/
// EDGE_DATA_FIELDS onto the reconstructed data object regardless of
// whether the underlying Y.Map actually had that key - producing nodes
// and edges with several extra keys present-but-undefined (color,
// hideLabel, labelAnchorT, labelOffsetX, labelOffsetY for edges;
// codeContent, codeLanguage, color, fontSize, icon,
// linkedRequirementIds, textColor for nodes) that the local/adapter
// store's equivalent objects never had at all. {a: undefined} and {}
// are indistinguishable to JSON.stringify (and therefore to
// canonicalJSON, and therefore to Part 1's own conformance check above),
// so this needed a comparison that actually inspects Object.keys()
// directly instead.
{
  function buildViaStore(store: DiagramStore) {
    const a = store.addNode([], "typed", { x: 0, y: 0 }, mkNodeData("A"));
    const b = store.addNode([], "typed", { x: 100, y: 0 }, mkNodeData("B"));
    store.addEdge([], a, b, mkEdgeData(), "right", "left");
    return store.getSnapshot();
  }

  const localSnap = buildViaStore(createLocalDiagramStore());
  const yjsSnap = buildViaStore(createYjsDiagramStore(new Y.Doc()));

  const localNodeKeys = Object.keys(localSnap.nodes[0].data).sort();
  const yjsNodeKeys = Object.keys(yjsSnap.nodes[0].data).sort();
  assert(
    JSON.stringify(localNodeKeys) === JSON.stringify(yjsNodeKeys),
    `local and Yjs stores produce node data objects with the exact same set of keys, not just equal values for the keys both happen to share - local has [${localNodeKeys.join(", ")}], Yjs has [${yjsNodeKeys.join(", ")}]`
  );

  const localEdgeKeys = Object.keys(localSnap.edges[0].data ?? {}).sort();
  const yjsEdgeKeys = Object.keys(yjsSnap.edges[0].data ?? {}).sort();
  assert(
    JSON.stringify(localEdgeKeys) === JSON.stringify(yjsEdgeKeys),
    `local and Yjs stores produce edge data objects with the exact same set of keys, not just equal values for the keys both happen to share - local has [${localEdgeKeys.join(", ")}], Yjs has [${yjsEdgeKeys.join(", ")}]`
  );

  assert(
    !("color" in (yjsSnap.edges[0].data ?? {})) && !("labelAnchorT" in (yjsSnap.edges[0].data ?? {})),
    "specifically: an edge that never had color/labelAnchorT set doesn't have those keys present-but-undefined on the Yjs store's output at all - they're simply absent, exactly like the local store's output"
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
