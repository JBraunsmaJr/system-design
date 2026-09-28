/**
 * Standalone verification for projectCanvasElements - the nodes/edges
 * projection App hands to the canvas. Run with:
 *
 *   npx tsx src/app/canvasProjection.verify.ts
 *
 * What this protects is object IDENTITY, not values. React Flow and the
 * memoised node and edge components skip anything whose object is the same
 * as last render (WS1-R8), so a projection that returns equal-but-new
 * objects looks correct on screen and silently re-renders every node on
 * every change. The browser perf harness catches that too, but only after a
 * full build; this catches it in milliseconds, next to the code.
 */
import type { Node, Edge } from '@xyflow/react';
import { projectCanvasElements, type CanvasProjectionInput } from './canvasProjection';
import { populatedLevelCounts } from '../collab/stores/diagramStore';
import { NO_IN_FLIGHT, NO_EDGE_GESTURES, type InFlightMap } from '../domain/canvas/gestureGeometry';
import type { ArchNodeData, ArchEdgeData } from '../domain/canvas/types';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('ok:', msg);
  }
}

function makeNode(id: string, x: number, parentPath?: string[]): Node<ArchNodeData> {
  return {
    id,
    type: 'typed',
    position: { x, y: 0 },
    width: 100,
    height: 50,
    data: {
      nodeType: 'service',
      label: id,
      properties: {},
      tags: [],
      ...(parentPath ? { parentPath } : {}),
    } as ArchNodeData,
  };
}

function makeEdge(id: string, source: string, target: string): Edge<ArchEdgeData> {
  return {
    id,
    source,
    target,
    data: { edgeType: 'blank-solid', label: '', direction: 'forward', properties: {} },
  };
}

// The store keeps untouched objects stable across snapshots
// (yjsDiagramStore.ts); the fixtures model that by reusing the same objects.
const a = makeNode('a', 0);
const b = makeNode('b', 200);
const c = makeNode('c', 400);
const nested = makeNode('inner', 0, ['a']);
const e1 = makeEdge('e1', 'a', 'b');
const e2 = makeEdge('e2', 'b', 'c');

function input(overrides: Partial<CanvasProjectionInput> = {}): CanvasProjectionInput {
  const diagramSnapshot = overrides.diagramSnapshot ?? {
    nodes: [a, b, c, nested],
    edges: [e1, e2],
  };
  return {
    diagramSnapshot,
    subDiagramLevelCounts: populatedLevelCounts(diagramSnapshot.nodes),
    path: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    measuredDimensions: new Map(),
    inFlight: NO_IN_FLIGHT,
    peerInFlight: NO_IN_FLIGHT,
    edgeInFlight: NO_EDGE_GESTURES,
    peerEdgeInFlight: new Map(),
    peerEdgeLabels: new Map(),
    ...overrides,
  };
}

const byId = <T extends { id: string }>(items: T[], id: string) => items.find((i) => i.id === id)!;

/*
 * The caches remember the LAST derivation of each store object, the way
 * React compares against the previous render - not any earlier one. So each
 * part below compares against a projection taken immediately before it,
 * never against one from an earlier part.
 */

// === Part 1: the same inputs give the same objects =========================
const first = projectCanvasElements(input());
{
  const again = projectCanvasElements(input());
  assert(first.nodes.length === 3, 'only the root level is projected at path []');
  assert(
    first.nodes.every((n, i) => n === again.nodes[i]),
    'every node is the identical object when nothing changed',
  );
  assert(
    first.edges.every((e, i) => e === again.edges[i]),
    'every edge is the identical object when nothing changed',
  );
  assert(first.nodes[0] !== a, 'the projected node is a derived object, not the store object');
}

// === Part 2: selecting one node gives only that node a new object ==========
{
  const selected = projectCanvasElements(input({ selectedNodeIds: ['b'] }));
  assert(byId(selected.nodes, 'b') !== byId(first.nodes, 'b'), 'the selected node is new');
  assert(byId(selected.nodes, 'b').selected === true, 'and it is marked selected');
  assert(byId(selected.nodes, 'a') === byId(first.nodes, 'a'), 'an unselected node is reused');
  assert(byId(selected.nodes, 'c') === byId(first.nodes, 'c'), 'so is every other one');
  assert(
    byId(selected.nodes, 'b').data === byId(first.nodes, 'b').data,
    "selection alone keeps the node's data object, so memoised node bodies skip it",
  );
  assert(
    selected.edges.every((e, i) => e === first.edges[i]),
    'selecting a node gives no edge a new object',
  );
}

// === Part 3: a drag gives only the dragged node a new object ===============
{
  const before = projectCanvasElements(input());
  const inFlight: InFlightMap = new Map([['c', { position: { x: 450, y: 10 } }]]);
  const dragging = projectCanvasElements(input({ inFlight }));
  const dragged = byId(dragging.nodes, 'c');
  assert(dragged.position.x === 450 && dragged.position.y === 10, 'in-flight geometry is applied');
  assert(c.position.x === 400, 'without mutating the store object');
  assert(
    byId(dragging.nodes, 'a') === byId(before.nodes, 'a'),
    'a node not being dragged is reused',
  );
  assert(byId(dragging.nodes, 'b') === byId(before.nodes, 'b'), 'as is every other one');
  assert(
    dragging.edges.every((e, i) => e === before.edges[i]),
    'a node drag gives no edge a new object',
  );

  const peer: InFlightMap = new Map([['a', { position: { x: 5, y: 5 } }]]);
  const both = projectCanvasElements(input({ inFlight, peerInFlight: peer }));
  assert(byId(both.nodes, 'a').position.x === 5, "a peer's in-flight geometry is applied");
  const contested = projectCanvasElements(
    input({ inFlight, peerInFlight: new Map([['c', { position: { x: 0, y: 0 } }]]) }),
  );
  assert(
    byId(contested.nodes, 'c').position.x === 450,
    "this user's own gesture wins over a peer's on the same node",
  );
}

// === Part 4: a store change to one node re-derives only that node ==========
{
  const before = projectCanvasElements(input());
  const bMoved = { ...b, position: { x: 250, y: 0 } };
  const changed = projectCanvasElements(
    input({ diagramSnapshot: { nodes: [a, bMoved, c, nested], edges: [e1, e2] } }),
  );
  assert(byId(changed.nodes, 'b').position.x === 250, 'the changed node reflects the store');
  assert(byId(changed.nodes, 'a') === byId(before.nodes, 'a'), 'an untouched node is reused');
  assert(byId(changed.nodes, 'c') === byId(before.nodes, 'c'), 'as is every other one');
}

// === Part 5: sub-diagram counts reach the node's data ======================
{
  const root = projectCanvasElements(input());
  const nodeA = byId(root.nodes, 'a');
  assert(nodeA.data.hasSubDiagram === true, 'a node with nested content reports a sub-diagram');
  assert(nodeA.data.subDiagramNodeCount === 1, 'with its nested node count');
  assert(byId(root.nodes, 'b').data.hasSubDiagram === false, 'an empty node reports none');

  const drilled = projectCanvasElements(input({ path: ['a'] }));
  assert(
    drilled.nodes.length === 1 && drilled.nodes[0].id === 'inner',
    'drilling in projects only that level',
  );
}

// === Part 6: edge selection and in-flight bends ============================
{
  const before = projectCanvasElements(input());
  const selected = projectCanvasElements(input({ selectedEdgeIds: ['e2'] }));
  assert(byId(selected.edges, 'e2').selected === true, 'the selected edge is marked');
  assert(byId(selected.edges, 'e1') === byId(before.edges, 'e1'), 'an unselected edge is reused');
  assert(
    selected.nodes.every((n, i) => n === before.nodes[i]),
    'selecting an edge gives no node a new object',
  );

  const unbent = projectCanvasElements(input());
  const bent = projectCanvasElements(
    input({ peerEdgeInFlight: new Map([['e1', [{ id: 'w1', x: 10, y: 20 }]]]) }),
  );
  assert(
    byId(bent.edges, 'e1').data?.waypoints?.[0]?.x === 10,
    "a peer's in-flight bend is applied",
  );
  assert(byId(bent.edges, 'e2') === byId(unbent.edges, 'e2'), 'the other edge is reused');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
// scripts/run-tests.ts reads the exit status; printing FAIL is not enough.
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
