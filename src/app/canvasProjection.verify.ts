/**
 * Standalone verification for projectCanvasElements - the nodes/edges
 * projection App hands to the canvas. Run with:
 *
 *   npx tsx src/app/canvasProjection.verify.ts
 *
 * What this protects is object IDENTITY, not values. React Flow and the
 * memoized node and edge components skip anything whose object is the same
 * as last render (WS1-R8), so a projection that returns equal-but-new
 * objects looks correct on screen and silently re-renders every node on
 * every change. The browser perf harness catches that too, but only after a
 * full build; this catches it in milliseconds, next to the code.
 */
import type {Edge, Node} from '@xyflow/react';
import {type CanvasProjectionInput, projectBoundaryPorts, projectCanvasElements,} from './canvasProjection';
import {buildPortIndex, portId} from '../domain/canvas/boundaryPorts';
import {populatedLevelCounts} from '../collab/stores/diagramStore';
import {type InFlightMap, NO_EDGE_GESTURES, NO_IN_FLIGHT} from '../domain/canvas/gestureGeometry';
import type {ArchEdgeData, ArchNodeData} from '../domain/canvas/types';

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
    "selection alone keeps the node's data object, so memoized node bodies skip it",
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

// --- Boundary ports (domain/canvas/boundaryPorts.ts) ---
{
  // Root: outside -> box -> sink. Inside box: inner (+ a wire from the
  // inbound port), plus an orphan wire to a port of an edge that is gone.
  const outside = makeNode('outside', 0);
  const box = makeNode('box', 200);
  const sink = makeNode('sink', 400);
  const inner = makeNode('inner', 50, ['box']);
    const inEdge = {...makeEdge('in-e', 'outside', 'box')};
  const outEdge = makeEdge('out-e', 'box', 'sink');
  const wire: Edge<ArchEdgeData> = {
    ...makeEdge('wire', portId('in-e', 'in'), 'inner'),
      data: {...makeEdge('x', 'a', 'b').data!, parentPath: ['box']} as ArchEdgeData,
  };
  const orphan: Edge<ArchEdgeData> = {
    ...makeEdge('orphan', portId('gone', 'in'), 'inner'),
      data: {...makeEdge('x', 'a', 'b').data!, parentPath: ['box']} as ArchEdgeData,
  };
  const snapshot = {
    nodes: [outside, box, sink, inner],
    edges: [inEdge, outEdge, wire, orphan],
  };
  const portIndex = buildPortIndex(snapshot.nodes, snapshot.edges);

    const root = projectCanvasElements(input({diagramSnapshot: snapshot, portIndex}));
  assert(
      byId(root.nodes, 'box').data.unwiredPortCount === 1,
      'a node with a sub-diagram reports the one connection not wired inside',
  );
  assert(
      byId(root.nodes, 'outside').data.unwiredPortCount === undefined,
      'a node without a sub-diagram reports nothing',
  );

    const insideInput = input({diagramSnapshot: snapshot, portIndex, path: ['box']});
  const inside = projectCanvasElements(insideInput);
  assert(
      inside.edges.some((e) => e.id === 'wire') && !inside.edges.some((e) => e.id === 'orphan'),
      'a valid wire is drawn; an orphaned one is not',
  );

  const portArgs = {
    portIndex,
    path: ['box'],
    diagramSnapshot: snapshot,
    measuredDimensions: new Map<string, { width: number; height: number }>(),
  };
  const ports = projectBoundaryPorts(portArgs);
  assert(ports.length === 2, 'one port per connection to the box');
  const inPort = byId(ports, portId('in-e', 'in'));
  const outPort = byId(ports, portId('out-e', 'out'));
  assert(
      inPort.position.x < inner.position.x && outPort.position.x > inner.position.x + 100,
      'inbound ports sit left of everything inside, outbound ports right of it',
  );
  assert(
      inPort.draggable === false && inPort.selectable === false && inPort.deletable === false,
      'ports cannot be dragged, selected or deleted',
  );
  assert(inPort.className === 'nopan', 'ports are nopan, so a double-click reaches them');

    const again = projectBoundaryPorts({...portArgs, measuredDimensions: new Map()});
  assert(
      byId(again, inPort.id) === inPort && byId(again, outPort.id) === outPort,
      'unchanged ports are the same objects on the next projection',
  );
  const measured = projectBoundaryPorts({
    ...portArgs,
      measuredDimensions: new Map([[inPort.id, {width: 200, height: 44}]]),
  });
  assert(
      byId(measured, inPort.id) !== inPort && byId(measured, inPort.id).measured?.height === 44,
      "a port's measured size is re-attached",
  );
  assert(byId(measured, outPort.id) === outPort, 'and the other port is reused');
}

// --- Duplicate boundary ports (two connections to the same node) ---
{
  const box = makeNode('box', 0);
  const sink = makeNode('sink', 400);
  const inner = makeNode('inner', 50, ['box']);
  const first = makeEdge('out-1', 'box', 'sink');
  const second = makeEdge('out-2', 'box', 'sink');
  const wire: Edge<ArchEdgeData> = {
    ...makeEdge('wire-2', 'inner', portId('out-2', 'out')),
    data: {...makeEdge('x', 'a', 'b').data!, parentPath: ['box']} as ArchEdgeData,
  };
  const snapshot = {nodes: [box, sink, inner], edges: [first, second, wire]};
  const portIndex = buildPortIndex(snapshot.nodes, snapshot.edges);
  const ports = projectBoundaryPorts({
    portIndex,
    path: ['box'],
    diagramSnapshot: snapshot,
    measuredDimensions: new Map(),
  });
  assert(
      ports.length === 1 && ports[0].id === portId('out-1', 'out'),
      'the same node reached by two connections is drawn as one port',
  );
  const inside = projectCanvasElements(input({diagramSnapshot: snapshot, portIndex, path: ['box']}));
  const drawn = byId(inside.edges, 'wire-2');
  assert(
      drawn.target === portId('out-1', 'out'),
      'a wire to the folded port is drawn to the port that is on the canvas',
  );
  const again = projectCanvasElements(input({diagramSnapshot: snapshot, portIndex, path: ['box']}));
  assert(byId(again.edges, 'wire-2') === drawn, 'the redirected wire is the same object next time');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
// scripts/run-tests.ts reads the exit status; printing FAIL is not enough.
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
