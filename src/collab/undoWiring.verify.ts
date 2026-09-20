/**
 * WS1 Step 6 - undo wired through the seams (WS3-R1..R4, WS1-R7).
 *
 * undoManager.verify.ts proves the controller. This proves the wiring: that
 * every store the app hands out routes its edits through the undo origin, that
 * document boundaries stay out of history, and that title and scenarios - now
 * in the document - behave like everything else.
 */
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import {
  openDocument,
  createDocumentStores,
  destroyDocumentStores,
  replaceDocumentContents,
  type OpenDocumentStores,
} from './localDocument.ts';
import {
  createUndoController,
  undoableStore,
  undoControllerFor,
  releaseUndoController,
  type UndoController,
} from './undoManager.ts';
import {
  seedYjsDocumentMeta,
  createYjsDocumentMetaStore,
  DEFAULT_DOCUMENT_TITLE,
} from './yjsDocumentMetaStore.ts';
import { rebaseDocument } from './rebase.ts';
import { SCHEMA_VERSION, type DiagramFile } from '../domain/serialization.ts';
import { EMPTY_REQUIREMENTS_DOCUMENT } from '../domain/requirementsTypes.ts';
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from '../domain/requirementsRegistry.ts';
import { EMPTY_TEAM_DOCUMENT } from '../domain/teamTypes.ts';
import type { Scenario } from '../domain/types.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const SCENARIO: Scenario = { id: 'sc-1', title: 'Checkout', steps: [] };

function makeFile(title: string): DiagramFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes: [
      {
        id: 'n1',
        type: 'typed',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'service',
          label: 'Gateway',
          subDiagram: {
            nodes: [
              {
                id: 'n1-child',
                type: 'typed',
                position: { x: 5, y: 5 },
                data: { nodeType: 'service', label: 'Inner' },
              },
            ],
            edges: [],
          },
        },
      },
    ],
    edges: [],
    scenarios: [
      {
        id: 'sc-file',
        title: 'From file',
        steps: [{ id: 'st', title: 's', nodeIds: [], edgeIds: [] }],
      },
    ],
    requirements: {
      ...EMPTY_REQUIREMENTS_DOCUMENT,
      itemTypes: BUILT_IN_ITEM_TYPES,
      relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
    },
    programIncrements: [],
    team: EMPTY_TEAM_DOCUMENT,
    milestones: [],
    metadata: { updatedAt: '2026-01-01T00:00:00.000Z' },
  } as unknown as DiagramFile;
}

function wrapAll(stores: OpenDocumentStores, undo: UndoController): OpenDocumentStores {
  return Object.fromEntries(
    Object.entries(stores).map(([k, v]) => [k, undoableStore(v as object, undo)]),
  ) as unknown as OpenDocumentStores;
}

const EXEMPT = new Set(['getSnapshot', 'subscribe', 'destroy', 'replaceAll']);

console.log('=== Every mutating method of every store is wrapped ===');
{
  const doc = new Y.Doc();
  const raw = createDocumentStores(doc);
  const wrapped = wrapAll(raw, createUndoController(doc));
  for (const [name, store] of Object.entries(raw)) {
    const w = (wrapped as unknown as Record<string, Record<string, unknown>>)[name];
    const entries = Object.entries(store as Record<string, unknown>).filter(
      ([, v]) => typeof v === 'function',
    );
    const unwrapped = entries.filter(([k, v]) => !EXEMPT.has(k) && w[k] === v).map(([k]) => k);
    const rewrapped = entries.filter(([k, v]) => EXEMPT.has(k) && w[k] !== v).map(([k]) => k);
    assert(
      unwrapped.length === 0 && rewrapped.length === 0 && entries.length === Object.keys(w).length,
      `${name}: ${entries.filter(([k]) => !EXEMPT.has(k)).length} edits wrapped, read/lifecycle methods passed through by identity`,
    );
  }
  destroyDocumentStores(raw);
}

console.log('\n=== A representative edit in each domain is undoable and redoable ===');
{
  const opened = await openDocument({
    docId: 'undo-domains',
    initial: makeFile('Start'),
    persist: false,
  });
  const undo = createUndoController(opened.doc, { captureTimeout: 0 });
  const s = wrapAll(opened.stores, undo);
  assert(!undo.canUndo(), 'nothing to undo right after opening (WS3-R4)');

  const cases: { name: string; read: () => unknown; edit: () => void }[] = [
    {
      name: 'diagram',
      read: () => s.diagram.getSnapshot().nodes.length,
      edit: () =>
        void s.diagram.addNode([], 'typed', { x: 9, y: 9 }, {
          nodeType: 'service',
          label: 'New',
        } as never),
    },
    {
      name: 'requirements',
      read: () => s.requirements.getSnapshot().items.length,
      edit: () => void s.requirements.addItem(BUILT_IN_ITEM_TYPES[0].id),
    },
    {
      name: 'programIncrements',
      read: () => s.programIncrements.getSnapshot().length,
      edit: () => void s.programIncrements.addPI(),
    },
    {
      name: 'team',
      read: () => s.team.getSnapshot().members.length,
      edit: () => s.team.addMember({ id: 'm1', name: 'Ada', ptoSpans: [] }),
    },
    {
      name: 'milestones',
      read: () => s.milestones.getSnapshot().length,
      edit: () =>
        void s.milestones.addMilestone({
          type: 'release',
          name: 'GA',
          scheduledAt: '2026-10-01',
        } as never),
    },
    {
      name: 'meta title',
      read: () => s.meta.getSnapshot().title,
      edit: () => s.meta.setTitle('Renamed'),
    },
    {
      name: 'meta scenarios',
      read: () => s.meta.getSnapshot().scenarios.map((sc) => sc.id),
      edit: () => s.meta.setScenarios([SCENARIO]),
    },
  ];
  for (const c of cases) {
    const before = JSON.stringify(c.read());
    c.edit();
    const after = JSON.stringify(c.read());
    undo.undo();
    const undone = JSON.stringify(c.read());
    undo.redo();
    const redone = JSON.stringify(c.read());
    undo.undo();
    assert(
      before !== after && undone === before && redone === after,
      `${c.name}: ${before} -> ${after}, undo restores, redo reapplies`,
    );
  }
  await opened.close();
}

console.log('\n=== Edits outside the wrapper are not undoable (pinned) ===');
{
  const doc = new Y.Doc();
  const raw = createDocumentStores(doc);
  const undo = createUndoController(doc, { captureTimeout: 0 });
  raw.diagram.addNode([], 'typed', { x: 0, y: 0 }, { nodeType: 'service', label: 'Raw' } as never);
  raw.meta.setTitle('Raw title');
  assert(
    !undo.canUndo(),
    'raw store edits leave history empty - which is how seeding stays out of it',
  );
  destroyDocumentStores(raw);
}

console.log('\n=== Document boundaries stay out of history (WS3-R4) ===');
{
  const key = `undo-boundary-${Math.random().toString(36).slice(2)}`;
  const first = await openDocument({ docId: key, initial: makeFile('Persisted') });
  const undoFirst = createUndoController(first.doc, { captureTimeout: 0 });
  assert(!undoFirst.canUndo(), 'seeding a new document is not undoable');
  undoableStore(first.stores.meta, undoFirst).setTitle('Edited before close');
  undoFirst.destroy();
  await first.close();

  const reopened = await openDocument({ docId: key, initial: makeFile('Ignored') });
  const undo = createUndoController(reopened.doc, { captureTimeout: 0 });
  assert(
    reopened.stores.meta.getSnapshot().title === 'Edited before close',
    'title persists with the document',
  );
  assert(!undo.canUndo(), 'restoring from persistence is not undoable');

  undoableStore(reopened.stores.meta, undo).setTitle('Edit');
  replaceDocumentContents(reopened.doc, makeFile('Loaded'));
  undo.clear();
  assert(!undo.canUndo(), 'after a file load and clear, undo is disabled');
  assert(reopened.stores.meta.getSnapshot().title === 'Loaded', 'a file load replaces the title');
  assert(
    JSON.stringify(reopened.stores.meta.getSnapshot().scenarios.map((sc) => sc.id)) ===
      JSON.stringify(['sc-file']),
    'a file load replaces the scenarios',
  );
  assert(
    JSON.stringify(reopened.stores.meta.getSnapshot().scenarios[0].steps[0].path) === '[]',
    'scenario steps without a path are normalised to the root at import',
  );
  undo.destroy();
  await reopened.close();
  await reopened.persistence.forget?.();
}

console.log('\n=== A drag collapses into one undo entry at the default timeout (WS3-R3) ===');
{
  const doc = new Y.Doc();
  const raw = createDocumentStores(doc);
  const undo = createUndoController(doc); // default 500ms
  const s = wrapAll(raw, undo);
  const id = s.diagram.addNode([], 'typed', { x: 0, y: 0 }, {
    nodeType: 'service',
    label: 'Drag me',
  } as never);
  undo.clear();
  for (let i = 1; i <= 20; i++) s.diagram.updatePosition(id, { x: i * 10, y: 0 });
  const pos = () => raw.diagram.getSnapshot().nodes.find((n) => n.id === id)?.position.x;
  assert(pos() === 200, 'twenty position writes land');
  undo.undo();
  assert(pos() === 0 && !undo.canUndo(), 'one undo returns the node to where the drag started');
  undo.destroy();
  destroyDocumentStores(raw);
}

console.log("\n=== Two peers: undo reverts only the local user's edits (WS3-R1, WS3-R2) ===");
{
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on(
    'update',
    (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b, u, 'remote'),
  );
  b.on(
    'update',
    (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a, u, 'remote'),
  );
  const rawA = createDocumentStores(a);
  const rawB = createDocumentStores(b);
  const undoA = createUndoController(a, { captureTimeout: 0 });
  const undoB = createUndoController(b, { captureTimeout: 0 });
  const A = wrapAll(rawA, undoA);
  const B = wrapAll(rawB, undoB);

  A.meta.setTitle("A's title");
  const aNode = A.diagram.addNode([], 'typed', { x: 0, y: 0 }, {
    nodeType: 'service',
    label: 'A',
  } as never);
  const bNode = B.diagram.addNode([], 'typed', { x: 1, y: 1 }, {
    nodeType: 'service',
    label: 'B',
  } as never);
  B.meta.setScenarios([SCENARIO]);
  assert(
    rawA.meta.getSnapshot().scenarios.length === 1 && rawB.meta.getSnapshot().title === "A's title",
    'title and scenarios sync between peers (WS1-R7)',
  );

  undoA.undo();
  undoA.undo();
  const ids = (s: OpenDocumentStores) => s.diagram.getSnapshot().nodes.map((n) => n.id);
  assert(
    !ids(rawA).includes(aNode) && !ids(rawB).includes(aNode),
    "A's node is gone for both peers",
  );
  assert(
    rawB.meta.getSnapshot().title === DEFAULT_DOCUMENT_TITLE,
    "A's rename is reverted for both peers",
  );
  assert(
    ids(rawA).includes(bNode) && rawA.meta.getSnapshot().scenarios.length === 1,
    "B's node and scenarios are untouched",
  );
  assert(!undoA.canUndo() && undoB.canUndo(), "A has nothing left to undo; B's history is intact");
  destroyDocumentStores(rawA);
  destroyDocumentStores(rawB);
}

console.log('\n=== Meta seeding ===');
{
  const doc = new Y.Doc();
  seedYjsDocumentMeta(doc, { title: 'First' });
  seedYjsDocumentMeta(doc, { title: 'Second', scenarios: [SCENARIO] });
  const meta = createYjsDocumentMetaStore(doc);
  assert(meta.getSnapshot().title === 'First', 'an existing title is never overwritten by a seed');
  assert(meta.getSnapshot().scenarios.length === 1, 'a missing key is still filled in');
  const snap = meta.getSnapshot();
  assert(meta.getSnapshot() === snap, 'the snapshot is cached until the map changes');
  meta.destroy();

  // A document persisted before title lived in the document: populated, but
  // no meta. The restored autosave is where its title still is.
  const key = `legacy-${Math.random().toString(36).slice(2)}`;
  const legacy = await openDocument({ docId: key, initial: makeFile('unused') });
  legacy.doc.getMap('meta').clear();
  await legacy.close();
  const back = await openDocument({ docId: key, initial: makeFile('From autosave') });
  assert(!back.wasSeeded, 'a populated legacy document is not reseeded');
  assert(
    back.stores.meta.getSnapshot().title === 'From autosave',
    'but it recovers its title from the autosave',
  );
  await back.close();
}

console.log('\n=== Controller cache and rebase ===');
{
  const doc = new Y.Doc();
  const c1 = undoControllerFor(doc);
  assert(
    undoControllerFor(doc) === c1,
    'one controller per document, however often it is requested',
  );
  releaseUndoController(doc);
  assert(undoControllerFor(doc) !== c1, 'released controllers are replaced, not reused');
  releaseUndoController(doc);

  const src = new Y.Doc();
  seedYjsDocumentMeta(src, { title: 'Keep me', scenarios: [SCENARIO] });
  const { doc: rebased } = rebaseDocument(src);
  const m = createYjsDocumentMetaStore(rebased).getSnapshot();
  assert(m.title === 'Keep me' && m.scenarios.length === 1, 'rebase carries title and scenarios');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log('\nAll undo wiring checks passed.');
}
