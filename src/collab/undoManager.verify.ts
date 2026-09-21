/**
 * WS3-R1 through R4.
 *
 * The case that matters most is peer isolation: two documents syncing, one
 * user presses undo, and the other user's work must be untouched. That is
 * simulated here by exchanging Yjs updates directly rather than over WebRTC -
 * the merge behaviour is identical, and it runs in Node.
 */
import * as Y from 'yjs';
import { createUndoController } from './undoManager.ts';
import { seedYjsDiagramDoc, createYjsDiagramStore } from './yjsDiagramStore.ts';
import type { SubDiagram } from '../domain/types';

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
  nodes: [
    {
      id: 'n1',
      type: 'typed',
      position: { x: 0, y: 0 },
      data: { nodeType: 'service', label: 'Gateway' },
    },
  ],
  edges: [],
} as unknown as SubDiagram;

function labelsOf(doc: Y.Doc): string[] {
  return createYjsDiagramStore(doc)
    .getSnapshot()
    .nodes.map((n) => (n.data as { label?: string }).label ?? '');
}

/** Keeps two docs in sync the way two connected peers would be. */
function connect(a: Y.Doc, b: Y.Doc) {
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    Y.applyUpdate(b, update, 'remote');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    Y.applyUpdate(a, update, 'remote');
  });
}

console.log('=== Undo works with no session at all ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const undo = createUndoController(doc, { captureTimeout: 0 });
  const store = createYjsDiagramStore(doc);

  assert(!undo.canUndo(), 'nothing to undo before any edit');

  undo.transact(() => {
    store.addNode([], 'typed', { x: 100, y: 0 }, {
      nodeType: 'service',
      label: 'Added',
    } as never);
  });

  assert(undo.canUndo(), 'after an edit, undo is available');
  assert(labelsOf(doc).includes('Added'), 'the edit is present');

  undo.undo();
  assert(!labelsOf(doc).includes('Added'), 'undo reverses it');
  assert(undo.canRedo(), 'and redo becomes available');

  undo.redo();
  assert(labelsOf(doc).includes('Added'), 'redo restores it');
  undo.destroy();
}

console.log('=== Edits outside transact() are not undoable ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const undo = createUndoController(doc, { captureTimeout: 0 });

  createYjsDiagramStore(doc).addNode([], 'typed', { x: 50, y: 0 }, {
    nodeType: 'service',
    label: 'Untagged',
  } as never);

  assert(
    !undo.canUndo(),
    'an edit made without the local origin is not tracked - all local ' +
      'mutations must go through transact()',
  );
  undo.destroy();
}

console.log("=== Undo never touches a peer's work (WS3-R2) ===");
{
  const alice = new Y.Doc();
  const bob = new Y.Doc();
  seedYjsDiagramDoc(alice, root);
  connect(alice, bob);
  // Bring bob up to date with the seed.
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice), 'remote');

  const aliceUndo = createUndoController(alice, { captureTimeout: 0 });
  const bobUndo = createUndoController(bob, { captureTimeout: 0 });

  aliceUndo.transact(() => {
    createYjsDiagramStore(alice).addNode([], 'typed', { x: 100, y: 0 }, {
      nodeType: 'service',
      label: 'From Alice',
    } as never);
  });
  bobUndo.transact(() => {
    createYjsDiagramStore(bob).addNode([], 'typed', { x: 200, y: 0 }, {
      nodeType: 'database',
      label: 'From Bob',
    } as never);
  });

  assert(
    labelsOf(alice).includes('From Bob') && labelsOf(bob).includes('From Alice'),
    'both edits converge on both peers',
  );

  aliceUndo.undo();

  assert(!labelsOf(alice).includes('From Alice'), "Alice's undo removes Alice's node");
  assert(
    labelsOf(alice).includes('From Bob'),
    "and leaves Bob's node alone - the whole point of origin scoping",
  );
  assert(
    labelsOf(bob).includes('From Bob') && !labelsOf(bob).includes('From Alice'),
    'Bob sees the same result, not a surprise deletion of his own work',
  );

  assert(!bobUndo.canRedo(), "Bob has nothing to redo - Alice's undo did not enter his stack");

  bobUndo.undo();
  assert(!labelsOf(alice).includes('From Bob'), 'Bob undoing his own edit removes it everywhere');

  aliceUndo.destroy();
  bobUndo.destroy();
}

console.log('=== Remote edits do not become undoable locally ===');
{
  const alice = new Y.Doc();
  const bob = new Y.Doc();
  seedYjsDiagramDoc(alice, root);
  connect(alice, bob);
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice), 'remote');

  const aliceUndo = createUndoController(alice, { captureTimeout: 0 });
  const bobUndo = createUndoController(bob, { captureTimeout: 0 });

  bobUndo.transact(() => {
    createYjsDiagramStore(bob).addNode([], 'typed', { x: 300, y: 0 }, {
      nodeType: 'service',
      label: 'Bob only',
    } as never);
  });

  assert(labelsOf(alice).includes('Bob only'), 'Alice receives the edit');
  assert(
    !aliceUndo.canUndo(),
    "but it does not appear in Alice's undo stack - she cannot undo work she " + 'did not do',
  );
  aliceUndo.destroy();
  bobUndo.destroy();
}

console.log('=== Bursts collapse into one entry (WS3-R3) ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const undo = createUndoController(doc, { captureTimeout: 10_000 });
  const store = createYjsDiagramStore(doc);

  const id = store.getSnapshot().nodes[0].id;
  for (let i = 0; i < 25; i++) {
    undo.transact(() => {
      store.updateNode(id, { label: `Drag frame ${i}` } as never);
    });
  }

  undo.undo();
  const label = labelsOf(doc)[0];
  assert(label === 'Gateway', `a 25-step burst reverses in one press (got "${label}")`);
  assert(!undo.canUndo(), 'and leaves nothing further to undo');
  undo.destroy();
}

console.log('=== Separated edits stay separate ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const undo = createUndoController(doc, { captureTimeout: 0 });
  const store = createYjsDiagramStore(doc);
  const id = store.getSnapshot().nodes[0].id;

  undo.transact(() => store.updateNode(id, { label: 'First' } as never));
  undo.transact(() => store.updateNode(id, { label: 'Second' } as never));

  undo.undo();
  assert(labelsOf(doc)[0] === 'First', 'one press reverses one edit');
  undo.undo();
  assert(labelsOf(doc)[0] === 'Gateway', 'the next press reverses the one before');
  undo.destroy();
}

console.log('=== History clears at a document boundary (WS3-R4) ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const undo = createUndoController(doc, { captureTimeout: 0 });
  undo.transact(() => {
    createYjsDiagramStore(doc).addNode([], 'typed', { x: 10, y: 0 }, {
      nodeType: 'service',
      label: 'Before',
    } as never);
  });
  assert(undo.canUndo(), 'there is history to clear');

  undo.clear();
  assert(!undo.canUndo(), 'clearing removes it');
  assert(!undo.canRedo(), 'including the redo side');
  assert(labelsOf(doc).includes('Before'), 'clearing history does not revert the document');
  undo.destroy();
}

console.log('=== Availability changes are published ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const undo = createUndoController(doc, { captureTimeout: 0 });
  let notifications = 0;
  const unsubscribe = undo.subscribe(() => notifications++);

  undo.transact(() => {
    createYjsDiagramStore(doc).addNode([], 'typed', { x: 20, y: 0 }, {
      nodeType: 'service',
      label: 'Watch',
    } as never);
  });
  assert(notifications > 0, 'adding an entry notifies subscribers');

  const afterAdd = notifications;
  undo.undo();
  assert(notifications > afterAdd, 'undoing notifies again');

  unsubscribe();
  const afterUnsubscribe = notifications;
  undo.redo();
  assert(notifications === afterUnsubscribe, 'unsubscribing stops notifications');
  undo.destroy();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} undo check(s) failed`);
}
console.log('\nAll undo checks passed.');
