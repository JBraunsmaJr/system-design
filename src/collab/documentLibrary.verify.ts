/**
 * WS2-R3 / WS2-R6 - operating on stored documents that are not open.
 */
import 'fake-indexeddb/auto';
import { createDocumentStore, type DocumentIndexEntry } from '../domain/documentStore.ts';
import { createIndexedDbBackend } from '../domain/indexedDbBackend.ts';
import { SCHEMA_VERSION, type DiagramFile } from '../domain/serialization.ts';
import { EMPTY_REQUIREMENTS_DOCUMENT } from '../domain/requirementsTypes.ts';
import { EMPTY_TEAM_DOCUMENT } from '../domain/teamTypes.ts';
import { openDocument, persistenceKeyForDocument } from './localDocument.ts';
import { persistenceKeyForRoom } from './persistence.ts';
import {
  createDocumentLibrary,
  contentDatabaseFor,
  type DeleteOutcome,
} from './documentLibrary.ts';
import { readDocumentContents } from './rebase.ts';
import { resolveReconciliationWindowDays } from '../domain/reconciliationWindow.ts';
import * as Y from 'yjs';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function makeFile(title: string): DiagramFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes: [
      {
        id: 'outer',
        type: 'typed',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'service',
          label: 'Outer',
          subDiagram: {
            nodes: [
              {
                id: 'inner',
                type: 'typed',
                position: { x: 1, y: 1 },
                data: { nodeType: 'service', label: 'Inner' },
              },
            ],
            edges: [],
          },
        },
      },
      {
        id: 'second',
        type: 'typed',
        position: { x: 5, y: 5 },
        data: { nodeType: 'service', label: 'Second' },
      },
    ],
    edges: [],
    scenarios: [{ id: 'sc', title: 'Flow', steps: [] }],
    requirements: EMPTY_REQUIREMENTS_DOCUMENT,
    programIncrements: [],
    team: EMPTY_TEAM_DOCUMENT,
    milestones: [],
    metadata: { updatedAt: '2026-01-01T00:00:00.000Z' },
  } as unknown as DiagramFile;
}

const deleted: string[] = [];
let nextOutcome: DeleteOutcome = 'deleted';
const store = createDocumentStore(createIndexedDbBackend());
const library = createDocumentLibrary({
  store,
  deleteDatabase: async (name) => {
    deleted.push(name);
    await new Promise<void>((res, rej) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
    return nextOutcome;
  },
});

async function storeLocal(docId: string, title: string): Promise<DocumentIndexEntry> {
  const opened = await openDocument({ docId, initial: makeFile(title) });
  await opened.close();
  const written = await store.writeDocument(docId, makeFile(title));
  if (!written.ok) throw new Error(written.message);
  return written.value;
}

async function contentOf(docId: string) {
  const opened = await openDocument({ docId });
  const result = {
    title: opened.stores.meta.getSnapshot().title,
    nodes: opened.stores.diagram.getSnapshot().nodes.length,
    scenarios: opened.stores.meta.getSnapshot().scenarios.length,
  };
  await opened.close();
  return result;
}

console.log('=== Content database ===');
assert(
  contentDatabaseFor({ docId: 'abc' }) === persistenceKeyForDocument('abc'),
  'a local document lives under its document key',
);
assert(
  contentDatabaseFor({ docId: 'hosted' }) === persistenceKeyForDocument('hosted'),
  'a local document that was shared still lives under its document key',
);
assert(
  contentDatabaseFor({ docId: 'session:r1' }) === persistenceKeyForRoom('r1'),
  "a joined session's replica lives under its room key",
);

console.log('\n=== Rename a closed document ===');
const alpha = await storeLocal('alpha', 'Alpha');
const renamed = await library.rename(alpha, '  Alpha renamed ');
assert(
  renamed.ok && renamed.value.title === 'Alpha renamed',
  'the index shows the new (trimmed) name',
);
assert(
  (await contentOf('alpha')).title === 'Alpha renamed',
  'and so does the document itself, so the next save keeps it',
);
const blank = await library.rename(alpha, '   ');
assert(!blank.ok, 'a blank name is refused');

console.log('\n=== Duplicate ===');
const dup = await library.duplicate({ ...alpha, title: 'Alpha renamed' });
assert(
  dup.ok && dup.value.docId !== 'alpha' && dup.value.title === 'Copy of Alpha renamed',
  'a new entry named as a copy',
);
if (dup.ok) {
  const copy = await contentOf(dup.value.docId);
  assert(
    copy.nodes === 3 && copy.scenarios === 1,
    `the copy has all content, nested levels included (${copy.nodes} nodes)`,
  );
  const edit = await openDocument({ docId: dup.value.docId });
  edit.stores.meta.setTitle('Edited copy');
  edit.stores.diagram.deleteNode('second');
  await edit.close();
  const original = await contentOf('alpha');
  assert(
    original.title === 'Alpha renamed' && original.nodes === 3,
    'editing the copy leaves the original untouched',
  );
}

console.log('\n=== Joined session replicas open like any document (WS13-R12) ===');
// What a joined session leaves behind: content under the room key, plus an
// index entry carrying the room and its key.
{
  const replica = await openDocument({
    docId: 'session:room-7',
    initial: makeFile('Team diagram'),
  });
  await replica.close();
}
const sessionEntry = await store.writeDocument('session:room-7', makeFile('Team diagram'), {
  origin: 'session',
  sessionRoom: 'room-7',
  sessionKey: 'k-123',
});
if (!sessionEntry.ok) throw new Error(sessionEntry.message);
assert(
  sessionEntry.value.sessionKey === 'k-123',
  'the index keeps the session key, so the room can be hosted again',
);
const again = await store.writeDocument('session:room-7', makeFile('Team diagram'));
assert(
  again.ok && again.value.sessionKey === 'k-123' && again.value.sessionRoom === 'room-7',
  'and later saves keep room and key',
);
{
  const reopened = await contentOf('session:room-7');
  assert(
    reopened.nodes === 3 && reopened.title === 'Team diagram',
    'its content opens from the room database',
  );
}
const sessionRename = await library.rename(sessionEntry.value, 'Team (renamed)');
assert(
  sessionRename.ok && sessionRename.value.title === 'Team (renamed)',
  'renaming works like any document',
);
assert(
  (await contentOf('session:room-7')).title === 'Team (renamed)',
  'including inside its content',
);
const sessionCopy = await library.duplicate(sessionEntry.value);
assert(
  sessionCopy.ok && sessionCopy.value.origin === 'local' && !sessionCopy.value.sessionRoom,
  'a copy is an ordinary local document, not tied to the room',
);
if (sessionCopy.ok)
  assert((await contentOf(sessionCopy.value.docId)).nodes === 3, 'with the full content');

console.log('\n=== Forget (WS2-R6) ===');
if (dup.ok) {
  deleted.length = 0;
  const forgotten = await library.forget(dup.value);
  assert(forgotten.ok && forgotten.value === 'deleted', 'forgetting succeeds');
  const listedAfter = await library.list();
  assert(
    listedAfter.ok && !listedAfter.value.some((e) => e.docId === dup.value.docId),
    'the entry is gone from the list',
  );
  assert(
    deleted.includes(persistenceKeyForDocument(dup.value.docId)),
    'its content database is deleted (WS2-R3)',
  );
  assert((await contentOf(dup.value.docId)).nodes === 0, 'reopening the id finds nothing');
  assert((await contentOf('alpha')).nodes === 3, 'other documents are untouched');
}
deleted.length = 0;
const forgottenSession = await library.forget(sessionEntry.value);
assert(
  forgottenSession.ok && deleted.includes(persistenceKeyForRoom('room-7')),
  'forgetting a session replica deletes the room database',
);
nextOutcome = 'blocked';
const blocked = await library.forget(alpha);
assert(
  blocked.ok && blocked.value === 'blocked',
  'a deletion held up by another tab is reported as blocked, not failed',
);

console.log('\n=== WS4-R7: compaction keeps identity, and offline clients merge ===');
{
  const doc = await openDocument({ docId: 'compact-me', initial: makeFile('Compact') });
  const offline = new Y.Doc();
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(doc.doc));
  // Edits that reach storage one update each (below y-indexeddb's own trim).
  for (let i = 0; i < 300; i++) doc.stores.diagram.updatePosition('second', { x: i, y: i });
  await doc.close();
  const entry = await store.writeDocument('compact-me', makeFile('Compact'));
  if (!entry.ok) throw new Error(entry.message);
  const compacted = await library.compact(entry.value);
  assert(
    compacted.ok && compacted.value.updatesBefore > 100 && compacted.value.updatesAfter === 1,
    `the update log collapses to one record (${compacted.ok ? `${compacted.value.updatesBefore} -> ${compacted.value.updatesAfter}` : compacted.message})`,
  );
  const reopened = await openDocument({ docId: 'compact-me' });
  const pos = reopened.stores.diagram.getSnapshot().nodes.find((n) => n.id === 'second')?.position;
  assert(pos?.x === 299, 'content is unchanged');
  // A client that was offline across the compaction, with its own edit.
  offline.transact(() => {
    (offline.getMap('meta') as Y.Map<unknown>).set('title', 'Edited offline');
  });
  reopened.stores.diagram.updatePosition('outer', { x: 42, y: 42 });
  Y.applyUpdate(reopened.doc, Y.encodeStateAsUpdate(offline, Y.encodeStateVector(reopened.doc)));
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(reopened.doc, Y.encodeStateVector(offline)));
  const merged = reopened.stores.meta.getSnapshot().title;
  const offlineSees = (offline.getMap('nodes').get('outer') as Y.Map<unknown>).get('position') as {
    x: number;
  };
  assert(
    merged === 'Edited offline' && offlineSees.x === 42,
    'an offline client reconciles with no loss in either direction',
  );
  await reopened.close();
}

console.log('\n=== WS4-R6: rebase shrinks a churned document, same content, new id ===');
{
  const many = makeFile('Churned');
  many.nodes = Array.from({ length: 50 }, (_, i) => ({
    id: `n${i}`,
    type: 'typed',
    position: { x: i, y: 0 },
    data: { nodeType: 'service', label: `Node ${i}` },
  })) as unknown as DiagramFile['nodes'];
  const churn = await openDocument({ docId: 'churned', initial: many });
  // Round-robin writes across 50 keys: the pattern WS4 measures, to ~24KB.
  let round = 0;
  while (Y.encodeStateAsUpdate(churn.doc).byteLength < 24_000) {
    churn.doc.transact(() => {
      for (let i = 0; i < 50; i++) churn.stores.diagram.updatePosition(`n${i}`, { x: round, y: i });
    });
    round++;
  }
  const before = readDocumentContents(churn.doc);
  const churnedBytes = Y.encodeStateAsUpdate(churn.doc).byteLength;
  await churn.close();
  const entry = await store.writeDocument('churned', many);
  if (!entry.ok) throw new Error(entry.message);
  const eligible = library.rebaseEligibility(entry.value);
  assert(eligible.allowed, 'a never-shared document may be rebased');
  const result = await library.rebase(entry.value);
  assert(result.ok, `rebase succeeds${result.ok ? '' : `: ${result.message}`}`);
  if (result.ok) {
    assert(
      result.value.bytesBefore >= 24_000 && result.value.bytesAfter < 7_000,
      `${churnedBytes} bytes -> ${result.value.bytesAfter} bytes (under 7KB)`,
    );
    assert(result.value.entry.docId !== 'churned', 'under a new document id');
    assert(
      !result.value.entry.sessionRoom && !result.value.entry.sessionKey,
      'with no session identity',
    );
    const fresh = await openDocument({ docId: result.value.entry.docId });
    const after = readDocumentContents(fresh.doc);
    const stored = Y.encodeStateAsUpdate(fresh.doc).byteLength;
    await fresh.close();
    assert(stored < 7_000, `and it is stored that small (${stored} bytes)`);
    assert(JSON.stringify(after.root) === JSON.stringify(before.root), 'the diagram is identical');
    assert(
      JSON.stringify({ ...after, meta: undefined, root: undefined }) ===
        JSON.stringify({ ...before, meta: undefined, root: undefined }),
      'and so is everything else',
    );
    assert(after.meta.title === 'Churned', 'keeping its name');
    const listed = await library.list();
    const original = listed.ok ? listed.value.find((e) => e.docId === 'churned') : undefined;
    assert(original?.title === 'Churned (before rebase)', 'the original is kept, relabelled');
  }
}

console.log('\n=== WS4-R8: rebase is blocked inside the reconciliation window ===');
{
  const DAY = 86_400_000;
  const shared = await store.writeDocument('shared-doc', makeFile('Shared'), {
    origin: 'session',
    sessionRoom: 'r9',
    sessionKey: 'k',
  });
  if (!shared.ok) throw new Error(shared.message);
  assert(!!shared.value.lastSessionAt, 'a save during a session records when it was last shared');
  const later = await store.writeDocument('shared-doc', makeFile('Shared'), { origin: 'local' });
  assert(
    later.ok && later.value.lastSessionAt === shared.value.lastSessionAt,
    'and a later local save keeps that time',
  );
  const sharedAt = Date.parse(shared.value.lastSessionAt ?? '');
  const blocked = library.rebaseEligibility(shared.value, sharedAt + 5 * DAY);
  assert(
    !blocked.allowed && /30 days/.test(blocked.reason ?? ''),
    `blocked five days later, naming the window: "${blocked.reason}"`,
  );
  assert(
    library.rebaseEligibility(shared.value, sharedAt + 31 * DAY).allowed,
    'allowed once the window has passed',
  );
  const legacy = { ...shared.value, lastSessionAt: undefined };
  assert(
    !library.rebaseEligibility(legacy, Date.parse(legacy.updatedAt) + DAY).allowed,
    'a shared document without the time falls back to its last save',
  );
  assert(resolveReconciliationWindowDays(undefined) === 30, 'the window defaults to 30 days');
  assert(resolveReconciliationWindowDays('3') === 7, 'and is never shorter than a week');
  assert(
    resolveReconciliationWindowDays('90') === 90 && resolveReconciliationWindowDays('soon') === 30,
    'configurable, with nonsense ignored',
  );
}

console.log('\n=== Listing order ===');
const listed = await library.list();
if (listed.ok) {
  const times = listed.value.map((e) => e.updatedAt);
  assert(
    times.every((t, i) => i === 0 || times[i - 1] >= t),
    'most recently updated first',
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log('\nAll document library checks passed.');
}
