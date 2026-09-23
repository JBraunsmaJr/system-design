/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/groupAdoption.verify.ts
 */
import {
  findNodesContainedInRect,
  getDescendantIds,
  isNodeContainedInRect,
  pickInnermostGroup,
  reorderWithGroupsFirst,
  selectNodesToAdopt,
  toAbsolutePosition,
  toRelativePosition,
} from './graphUtils';
import { createLocalDiagramStore } from '../collab/diagramStore';
import type { Node } from '@xyflow/react';
import type { ArchNodeData } from './types';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1; // run-tests.ts reads the exit status
    console.error(`FAIL: ${message}`);
  }
}

function mkNodeData(label: string, nodeType = 'service'): ArchNodeData {
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
      id: 'group-1',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 200,
      height: 150,
      data: mkNodeData('Boundary', 'region'),
    },
    {
      id: 'node-inside',
      type: 'typed',
      position: { x: 120, y: 120 },
      width: 80,
      height: 40,
      data: mkNodeData('Inside Node'),
    },
    {
      id: 'node-partial',
      type: 'typed',
      position: { x: 280, y: 120 },
      width: 80,
      height: 40,
      data: mkNodeData('Partial Node'),
    },
    {
      id: 'node-outside',
      type: 'typed',
      position: { x: 500, y: 500 },
      width: 80,
      height: 40,
      data: mkNodeData('Outside Node'),
    },
    {
      id: 'group-2',
      type: 'group',
      position: { x: 110, y: 110 },
      width: 50,
      height: 50,
      data: mkNodeData('Nested Boundary', 'vpc'),
    },
    {
      id: 'node-already-child',
      type: 'typed',
      parentId: 'group-1',
      position: { x: 10, y: 10 },
      width: 50,
      height: 30,
      data: mkNodeData('Existing Child'),
    },
  ];

  // Initial group rect: x: 100..300, y: 100..250
  const initialRect = { x: 100, y: 100, width: 200, height: 150 };
  assert(
    isNodeContainedInRect(nodes[1]!, nodes, initialRect),
    'isNodeContainedInRect returns true for node-inside',
  );
  assert(
    !isNodeContainedInRect(nodes[2]!, nodes, initialRect),
    'isNodeContainedInRect returns false for partial node',
  );
  assert(
    !isNodeContainedInRect(nodes[3]!, nodes, initialRect),
    'isNodeContainedInRect returns false for outside node',
  );

  const containedBeforeResize = findNodesContainedInRect(initialRect, nodes, 'group-1');

  const containedBeforeIds = containedBeforeResize.map((n) => n.id).sort();
  assert(
    containedBeforeIds.length === 2 &&
      containedBeforeIds[0] === 'group-2' &&
      containedBeforeIds[1] === 'node-inside',
    'initially node-inside and the nested boundary are the unparented, fully contained nodes',
  );

  // Resize group: expand to x: 100..400, y: 100..300
  // Now node-partial (280..360, 120..160) is fully contained inside 100..400, 100..300
  const resizedRect = { x: 100, y: 100, width: 300, height: 200 };
  const containedAfterResize = findNodesContainedInRect(resizedRect, nodes, 'group-1');
  const containedIds = containedAfterResize.map((n) => n.id);

  assert(containedIds.includes('node-inside'), 'node-inside remains contained in resized boundary');
  assert(
    containedIds.includes('node-partial'),
    'node-partial is now fully contained within resized boundary',
  );
  assert(!containedIds.includes('node-outside'), 'node-outside remains outside boundary');
  assert(
    containedIds.includes('group-2'),
    'a boundary fully inside another is adopted too - boundaries nest',
  );
  assert(
    !containedIds.includes('node-already-child'),
    'existing children of this group are excluded from re-adoption list',
  );
}

// --- Test 2: Reparenting from another group when resizing boundary ---
{
  const nodes: Node<ArchNodeData>[] = [
    {
      id: 'group-a',
      type: 'group',
      position: { x: 50, y: 50 },
      width: 100,
      height: 100,
      data: mkNodeData('Group A', 'region'),
    },
    {
      id: 'child-a',
      type: 'typed',
      parentId: 'group-a',
      position: { x: 10, y: 10 }, // absolute is (60, 60)
      width: 40,
      height: 30,
      data: mkNodeData('Child in Group A'),
    },
    {
      id: 'group-b',
      type: 'group',
      position: { x: 200, y: 50 },
      width: 100,
      height: 100,
      data: mkNodeData('Group B', 'region'),
    },
  ];

  // Group B is resized from top-left, expanding to x: 0, y: 0, w: 350, h: 200
  const groupBNewRect = { x: 0, y: 0, width: 350, height: 200 };
  const adopted = findNodesContainedInRect(groupBNewRect, nodes, 'group-b');

  assert(
    adopted.length === 1 && adopted[0]?.id === 'group-a',
    'group-a (fully inside resized group-b) is adopted as a whole',
  );
  assert(
    !adopted.some((n) => n.id === 'child-a'),
    'child-a is not pulled out of group-a - it comes along with its own boundary',
  );

  // A node whose boundary is NOT enclosed is still moved over.
  const partialRect = { x: 55, y: 55, width: 60, height: 60 };
  const stolen = findNodesContainedInRect(partialRect, nodes, 'group-b');
  assert(
    stolen.length === 1 && stolen[0]?.id === 'child-a',
    'child-a is adopted when only it (not group-a) is enclosed',
  );

  // Derive relative position to group-b's new position (0, 0)
  const childA = nodes.find((n) => n.id === 'child-a')!;
  const abs = toAbsolutePosition(childA, nodes, childA.parentId);
  assert(
    abs.x === 60 && abs.y === 60,
    'child-a absolute position is computed correctly through its old parent',
  );

  const newGroupPos = { x: groupBNewRect.x, y: groupBNewRect.y };
  const relativeToGroupB = { x: abs.x - newGroupPos.x, y: abs.y - newGroupPos.y };
  assert(
    relativeToGroupB.x === 60 && relativeToGroupB.y === 60,
    'relative position to new group origin preserves canvas placement',
  );
}

// --- Test 3: End-to-end DiagramStore group adoption upon boundary resize ---
{
  const store = createLocalDiagramStore();
  const groupId = store.addNode(
    [],
    'group',
    { x: 100, y: 100 },
    mkNodeData('Main Region', 'region'),
  );
  store.updateDimensions(groupId, 200, 150);

  const nodeId1 = store.addNode(
    [],
    'typed',
    { x: 350, y: 120 },
    mkNodeData('Service 1', 'service'),
  );

  const nodeId2 = store.addNode(
    [],
    'typed',
    { x: 350, y: 180 },
    mkNodeData('Database 1', 'database'),
  );

  const snapshotBefore = store.getSnapshot();
  const item1Before = snapshotBefore.nodes.find((n) => n.id === nodeId1)!;
  assert(item1Before.parentId === undefined, 'item 1 initially has no parent');

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
  assert(toAdopt.length === 2, 'both items within new boundary size are identified for adoption');

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

  assert(item1After.parentId === groupId, 'item 1 is now parented to the boundary group');
  assert(
    item1After.position.x === 250 && item1After.position.y === 20,
    'item 1 relative position is correctly set (350-100=250, 120-100=20)',
  );
  assert(item2After.parentId === groupId, 'item 2 is now parented to the boundary group');
  assert(
    item2After.position.x === 250 && item2After.position.y === 80,
    'item 2 relative position is correctly set (350-100=250, 180-100=80)',
  );
}

// --- Test 4: Nested boundaries (A contains B contains three nodes) ---
{
  const nodes: Node<ArchNodeData>[] = [
    {
      id: 'n1',
      type: 'typed',
      parentId: 'group-b',
      position: { x: 10, y: 10 },
      width: 40,
      height: 30,
      data: mkNodeData('N1'),
    },
    {
      id: 'group-b',
      type: 'group',
      parentId: 'group-a',
      position: { x: 50, y: 60 },
      width: 300,
      height: 200,
      data: mkNodeData('B', 'vpc'),
    },
    {
      id: 'n2',
      type: 'typed',
      parentId: 'group-b',
      position: { x: 100, y: 10 },
      width: 40,
      height: 30,
      data: mkNodeData('N2'),
    },
    {
      id: 'group-a',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 600,
      height: 400,
      data: mkNodeData('A', 'region'),
    },
    {
      id: 'n3',
      type: 'typed',
      parentId: 'group-b',
      position: { x: 200, y: 10 },
      width: 40,
      height: 30,
      data: mkNodeData('N3'),
    },
  ];

  const ordered = reorderWithGroupsFirst(nodes).map((n) => n.id);
  assert(
    ordered[0] === 'group-a' && ordered[1] === 'group-b',
    'outer boundary is ordered before the nested one (React Flow needs parents first)',
  );

  const n1Abs = toAbsolutePosition(nodes[0]!, nodes, 'group-b');
  assert(
    n1Abs.x === 160 && n1Abs.y === 170,
    'absolute position walks the whole parent chain (100+50+10, 100+60+10)',
  );
  const n1Rel = toRelativePosition(n1Abs, nodes, 'group-b');
  assert(n1Rel.x === 10 && n1Rel.y === 10, 'toRelativePosition inverts toAbsolutePosition');

  const descendants = getDescendantIds('group-a', nodes);
  assert(
    ['group-b', 'n1', 'n2', 'n3'].every((id) => descendants.has(id)) && descendants.size === 4,
    'descendants of A include B and everything inside B',
  );

  // Moving A moves B and B's contents: nothing below A needs to change,
  // every absolute position just shifts by the same delta.
  const moved = nodes.map((n) => (n.id === 'group-a' ? { ...n, position: { x: 400, y: 300 } } : n));
  const shifts = ['group-b', 'n1', 'n2', 'n3'].map((id) => {
    const before = nodes.find((n) => n.id === id)!;
    const after = moved.find((n) => n.id === id)!;
    const a = toAbsolutePosition(before, nodes, before.parentId);
    const b = toAbsolutePosition(after, moved, after.parentId);
    return { dx: b.x - a.x, dy: b.y - a.y };
  });
  assert(
    shifts.every((s) => s.dx === 300 && s.dy === 200),
    'moving A shifts B and all three of its nodes by the same amount',
  );

  // A dragged/resized over B and its nodes adopts only B.
  const adopt = selectNodesToAdopt('group-a', ['group-b', 'n1', 'n2', 'n3'], nodes);
  assert(adopt.length === 0, 'A re-adopts nothing it already contains at any depth');
  const flat = nodes.map((n) => (n.id === 'group-b' ? { ...n, parentId: undefined } : n));
  const adoptFlat = selectNodesToAdopt('group-a', ['group-b', 'n1', 'n2', 'n3'], flat);
  assert(
    adoptFlat.length === 1 && adoptFlat[0] === 'group-b',
    "A adopts B but leaves B's nodes as B's children",
  );
  assert(
    selectNodesToAdopt('group-b', ['group-a'], nodes).length === 0,
    'a boundary never adopts one of its own ancestors (no cycles)',
  );

  // Dropping a node that overlaps both A and B lands it in B.
  const innermost = pickInnermostGroup(
    'n-new',
    nodes.filter((n) => n.type === 'group'),
    nodes,
  );
  assert(innermost?.id === 'group-b', 'a node dropped over A and B joins the innermost (B)');
  assert(
    pickInnermostGroup('group-a', [nodes[1]!], nodes) === undefined,
    'a boundary is never parented into one of its own descendants',
  );
}

// --- Test 5: End-to-end DiagramStore, nesting B into A ---
{
  const store = createLocalDiagramStore();
  const a = store.addNode([], 'group', { x: 100, y: 100 }, mkNodeData('A', 'region'));
  store.updateDimensions(a, 600, 400);
  const b = store.addNode([], 'group', { x: 150, y: 160 }, mkNodeData('B', 'vpc'));
  store.updateDimensions(b, 300, 200);
  const kids = [0, 1, 2].map((i) =>
    store.addNode([], 'typed', { x: 10 + i * 90, y: 10 }, mkNodeData(`N${i}`)),
  );
  for (const k of kids) {
    const n = store.getSnapshot().nodes.find((nn) => nn.id === k)!;
    store.updateParentId(k, b, n.position);
  }

  // Same math as App.tsx's onReparentNode: B dropped inside A.
  const before = store.getSnapshot().nodes;
  const bNode = before.find((n) => n.id === b)!;
  const bAbs = toAbsolutePosition(bNode, before, bNode.parentId);
  store.updateParentId(b, a, toRelativePosition(bAbs, before, a));

  const absOf = (id: string) => {
    const all = store.getSnapshot().nodes;
    const n = all.find((nn) => nn.id === id)!;
    return toAbsolutePosition(n, all, n.parentId);
  };
  const kidsBefore = kids.map(absOf);
  const bAfterReparent = absOf(b);
  assert(
    bAfterReparent.x === 150 && bAfterReparent.y === 160,
    'B stays where it was dropped when it becomes a child of A',
  );

  store.updatePosition(a, { x: 300, y: 250 });
  const bMoved = absOf(b);
  assert(bMoved.x === 350 && bMoved.y === 310, 'moving A moves B');
  assert(
    kids
      .map(absOf)
      .every((p, i) => p.x === kidsBefore[i]!.x + 200 && p.y === kidsBefore[i]!.y + 150),
    'moving A moves every node inside B',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
