/**
 * Verification for the undo controller's read-only state: someone who may
 * only read a document cannot change it from this browser.
 * Run with: npx tsx src/collab/stores/undoReadOnly.verify.ts
 */
import * as Y from 'yjs';
import { createUndoController, undoableStore } from './undoManager.ts';

let failed = 0;
function check(condition: boolean, name: string) {
  if (!condition) failed += 1;
  console.log(`  ${condition ? '✓' : '✗'} ${name}`);
}

/** A store shaped like the editor's: readers passed through, writers wrapped. */
function storeOn(doc: Y.Doc) {
  const meta = doc.getMap<string>('meta');
  const order = doc.getArray<string>('nodeOrder');
  return {
    getSnapshot: () => ({ title: meta.get('title'), nodes: order.toArray() }),
    subscribe: () => () => {},
    destroy: () => {},
    setTitle: (title: string) => doc.transact(() => meta.set('title', title)),
    addNode: (id: string) => {
      doc.transact(() => order.push([id]));
      return id;
    },
    replaceAll: (title: string, nodes: string[]) =>
      doc.transact(() => {
        meta.set('title', title);
        order.delete(0, order.length);
        order.push(nodes);
      }),
  };
}

console.log('\n=== While read-only ===');
{
  const doc = new Y.Doc();
  const undo = createUndoController(doc, { captureTimeout: 0 });
  const raw = storeOn(doc);
  const store = undoableStore(raw, undo);
  store.setTitle('Shared architecture');
  store.addNode('a');
  const before = Y.encodeStateVector(doc);
  let updates = 0;
  doc.on('update', () => updates++);
  let refused = 0;
  const stopListening = undo.onRefused(() => refused++);
  let availabilityChanges = 0;
  undo.subscribe(() => availabilityChanges++);

  check(undo.canUndo(), 'before it is set, edits are undoable as usual');
  undo.setReadOnly(true);
  check(
    undo.isReadOnly() && availabilityChanges === 1,
    'setting it tells whoever shows undo and redo',
  );
  check(!undo.canUndo() && !undo.canRedo(), 'which are no longer offered');

  store.setTitle('My own title');
  const added = store.addNode('b');
  check(
    store.getSnapshot().title === 'Shared architecture' && store.getSnapshot().nodes.join() === 'a',
    'an edit through a store changes nothing',
  );
  check(added === undefined, 'and an edit that would return a value returns none');
  store.replaceAll('From a file', ['x', 'y']);
  check(
    store.getSnapshot().title === 'Shared architecture',
    'replacing the whole document, as loading a file does, is refused too',
  );
  undo.transact(() => doc.getMap('nodes').set('a', { label: 'Changed' }));
  check(doc.getMap('nodes').size === 0, 'so is an edit made directly under the controller');
  undo.undo();
  check(
    store.getSnapshot().nodes.join() === 'a',
    'and undo, which would take back an earlier edit',
  );
  check(
    updates === 0 && JSON.stringify([...Y.encodeStateVector(doc)]) === JSON.stringify([...before]),
    'nothing at all was written to the document: there is nothing to send, store or merge',
  );
  check(refused === 5, `each refusal is reported (${refused})`);

  console.log('\n=== Changes that arrive ===');
  const workspace = new Y.Doc();
  Y.applyUpdate(workspace, Y.encodeStateAsUpdate(doc));
  workspace.getMap('meta').set('title', 'Shared architecture, revised');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(workspace), 'workspace');
  check(
    store.getSnapshot().title === 'Shared architecture, revised',
    "the workspace's changes still apply: only this browser's edits are stopped",
  );

  console.log('\n=== Afterward ===');
  undo.setReadOnly(false);
  undo.setReadOnly(false);
  check(availabilityChanges === 2, 'clearing it is announced once');
  store.setTitle('Now an editor');
  check(store.getSnapshot().title === 'Now an editor', 'edits work again');
  check(undo.canUndo(), 'and are undoable');
  undo.undo();
  check(
    store.getSnapshot().title === 'Shared architecture, revised',
    'back to what the workspace had, not to anything refused in between',
  );
  stopListening();
  undo.setReadOnly(true);
  store.setTitle('x');
  check(refused === 5, 'a listener that has unsubscribed hears nothing more');
}

console.log('\n=== A store wrapped without a controller that can refuse ===');
{
  const doc = new Y.Doc();
  const store = undoableStore(storeOn(doc), { transact: (fn) => fn() });
  store.replaceAll('Loaded', ['a']);
  check(store.getSnapshot().title === 'Loaded', 'behaves as it always did');
}

if (failed > 0) console.error(`${failed} check(s) failed`);
