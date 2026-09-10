/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/groupAdoption.verify.ts
 */
import { findNodesContainedInRect, isNodeContainedInRect, toAbsolutePosition } from "./graphUtils";
import { createLocalDiagramStore } from "../collab/diagramStore";
import type { Node } from "@xyflow/react";
import type { ArchNodeData } from "./types";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

function mkNodeData(label: string, nodeType = "service"): ArchNodeData {
  return {
    label,
    nodeType,
    tags: [],
    properties: {},
  };
}

// --- Test 1: isNodeContainedInRect and findNodesContainedInRect ---
{
  const nodes: Node<ArchNodeData>[] = [
    {
      id: "group-1",
      type: "group",
      position: { x: 100, y: 100 },
      width: 200,
      height: 150,
      data: mkNodeData("Boundary", "region"),
    },
    {
      id: "node-inside",
      type: "typed",
      position: { x: 120, y: 120 },
      width: 80,
      height: 40,
      data: mkNodeData("Inside Node"),
    },
    {
      id: "node-partial",
      type: "typed",
      position: { x: 280, y: 120 },
      width: 80,
      height: 40,
      data: mkNodeData("Partial Node"),
    },
    {
      id: "node-outside",
      type: "typed",
      position: { x: 500, y: 500 },
      width: 80,
      height: 40,
      data: mkNodeData("Outside Node"),
    },
    {
      id: "group-2",
      type: "group",
      position: { x: 110, y: 110 },
      width: 50,
      height: 50,
      data: mkNodeData("Nested Boundary", "vpc"),
    },
    {
      id: "node-already-child",
      type: "typed",
      parentId: "group-1",
      position: { x: 10, y: 10 },
      width: 50,
      height: 30,
      data: mkNodeData("Existing Child"),
    },
  ];

  // Initial group rect: x: 100..300, y: 100..250
  const initialRect = { x: 100, y: 100, width: 200, height: 150 };
  assert(isNodeContainedInRect(nodes[1]!, nodes, initialRect), "isNodeContainedInRect returns true for node-inside");
  assert(!isNodeContainedInRect(nodes[2]!, nodes, initialRect), "isNodeContainedInRect returns false for partial node");
  assert(!isNodeContainedInRect(nodes[3]!, nodes, initialRect), "isNodeContainedInRect returns false for outside node");

  const containedBeforeResize = findNodesContainedInRect(initialRect, nodes, "group-1");

  assert(
    containedBeforeResize.length === 1 && containedBeforeResize[0]?.id === "node-inside",
    "initially only node-inside is unparented and fully contained"
  );

  // Resize group: expand to x: 100..400, y: 100..300
  // Now node-partial (280..360, 120..160) is fully contained inside 100..400, 100..300
  const resizedRect = { x: 100, y: 100, width: 300, height: 200 };
  const containedAfterResize = findNodesContainedInRect(resizedRect, nodes, "group-1");
  const containedIds = containedAfterResize.map((n) => n.id);

  assert(containedIds.includes("node-inside"), "node-inside remains contained in resized boundary");
  assert(containedIds.includes("node-partial"), "node-partial is now fully contained within resized boundary");
  assert(!containedIds.includes("node-outside"), "node-outside remains outside boundary");
  assert(!containedIds.includes("group-2"), "other group nodes are excluded from adoption");
  assert(!containedIds.includes("node-already-child"), "existing children of this group are excluded from re-adoption list");
}

// --- Test 2: Reparenting from another group when resizing boundary ---
{
  const nodes: Node<ArchNodeData>[] = [
    {
      id: "group-a",
      type: "group",
      position: { x: 50, y: 50 },
      width: 100,
      height: 100,
      data: mkNodeData("Group A", "region"),
    },
    {
      id: "child-a",
      type: "typed",
      parentId: "group-a",
      position: { x: 10, y: 10 }, // absolute is (60, 60)
      width: 40,
      height: 30,
      data: mkNodeData("Child in Group A"),
    },
    {
      id: "group-b",
      type: "group",
      position: { x: 200, y: 50 },
      width: 100,
      height: 100,
      data: mkNodeData("Group B", "region"),
    },
  ];

  // Group B is resized from top-left, expanding to x: 0, y: 0, w: 350, h: 200
  const groupBNewRect = { x: 0, y: 0, width: 350, height: 200 };
  const adopted = findNodesContainedInRect(groupBNewRect, nodes, "group-b");

  assert(adopted.length === 1 && adopted[0]?.id === "child-a", "child-a from group-a is detected as contained in resized group-b");

  // Derive relative position to group-b's new position (0, 0)
  const childA = adopted[0]!;
  const abs = toAbsolutePosition(childA, nodes, childA.parentId);
  assert(abs.x === 60 && abs.y === 60, "child-a absolute position is computed correctly through its old parent");

  const newGroupPos = { x: groupBNewRect.x, y: groupBNewRect.y };
  const relativeToGroupB = { x: abs.x - newGroupPos.x, y: abs.y - newGroupPos.y };
  assert(relativeToGroupB.x === 60 && relativeToGroupB.y === 60, "relative position to new group origin preserves canvas placement");
}

// --- Test 3: End-to-end DiagramStore group adoption upon boundary resize ---
{
  const store = createLocalDiagramStore();
  const groupId = store.addNode([], "group", { x: 100, y: 100 }, mkNodeData("Main Region", "region"));
  store.updateDimensions(groupId, 200, 150);

  const nodeId1 = store.addNode([], "typed", { x: 350, y: 120 }, mkNodeData("Service 1", "service"));

  const nodeId2 = store.addNode([], "typed", { x: 350, y: 180 }, mkNodeData("Database 1", "database"));

  const snapshotBefore = store.getSnapshot();
  const item1Before = snapshotBefore.nodes.find((n) => n.id === nodeId1)!;
  assert(item1Before.parentId === undefined, "item 1 initially has no parent");

  // User resizes the boundary: new rect { x: 100, y: 100, width: 400, height: 250 }
  const newRect = { x: 100, y: 100, width: 400, height: 250 };
  const flowNodes: Node<ArchNodeData>[] = snapshotBefore.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    parentId: n.parentId,
    width: n.width ?? 80,
    height: n.height ?? 40,
    data: n.data,
  }));

  const toAdopt = findNodesContainedInRect(newRect, flowNodes, groupId);
  assert(toAdopt.length === 2, "both items within new boundary size are identified for adoption");

  // Apply adoption (same logic as onAdoptIntoGroup)
  for (const node of toAdopt) {
    const abs = toAbsolutePosition(node, flowNodes, node.parentId);
    const rel = { x: abs.x - newRect.x, y: abs.y - newRect.y };
    store.updateParentId(node.id, groupId, rel);
  }
  store.updateDimensions(groupId, newRect.width, newRect.height);

  const snapshotAfter = store.getSnapshot();
  const item1After = snapshotAfter.nodes.find((n) => n.id === nodeId1)!;
  const item2After = snapshotAfter.nodes.find((n) => n.id === nodeId2)!;

  assert(item1After.parentId === groupId, "item 1 is now parented to the boundary group");
  assert(item1After.position.x === 250 && item1After.position.y === 20, "item 1 relative position is correctly set (350-100=250, 120-100=20)");
  assert(item2After.parentId === groupId, "item 2 is now parented to the boundary group");
  assert(item2After.position.x === 250 && item2After.position.y === 80, "item 2 relative position is correctly set (350-100=250, 180-100=80)");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
