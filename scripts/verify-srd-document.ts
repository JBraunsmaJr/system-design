/**
 * The SRD's journey through every document boundary: save to a file, load a
 * file, replace a document's contents, rebase, and undo.
 *
 * Run with: npx tsx scripts/verify-srd-document.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { openDocument, replaceDocumentContents } from '../src/collab/sync/localDocument.ts';
import { readDocumentContents, rebaseDocument } from '../src/collab/sync/rebase.ts';
import { createYjsSrdStore, SRD_FRAMING_MAP, SRD_MAP } from '../src/collab/stores/yjsSrdStore.ts';
import { undoableStore, createUndoController } from '../src/collab/stores/undoManager.ts';
import { parseDiagramFile, toDiagramFile } from '../src/domain/canvas/serialization.ts';
import { AGILE_ENGINEERING_TEMPLATE } from '../src/domain/srd/srdTemplatePresets.ts';
import { DEFAULT_SRD_DOCUMENT_STATE } from '../src/domain/srd/srdSettings.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const fixture = (version: string) =>
  readFileSync(join(fixturesDir, `schema-${version}.json`), 'utf8');

const fileFrom = (doc: Y.Doc) => {
  const c = readDocumentContents(doc);
  return toDiagramFile(
    c.meta.title,
    c.root.nodes,
    c.root.edges,
    c.meta.scenarios,
    c.requirements,
    c.programIncrements,
    c.team,
    c.milestones,
    c.srd,
  );
};

console.log('=== 1. A 0.8 file opens with its SRD ===');
{
  const opened = await openDocument({
    docId: 'srd-fixture',
    persist: false,
    initial: parseDiagramFile(fixture('0.8')),
  });
  const srd = opened.stores.srd.getSnapshot();
  assert(srd.settings.requirementsLayout === 'list', 'settings are seeded from the file');
  assert(srd.metadata.organization === 'Fixture Org', 'metadata is seeded from the file');
  assert(srd.framing['TICKET-1']?.zoom === 1.25, 'framing is seeded from the file');
  assert(srd.framing['REQ-1']?.hidden === true, 'a removed snapshot stays removed');
  await opened.close();
}

console.log('=== 2. A file from before the SRD opens with the defaults ===');
{
  const parsed = parseDiagramFile(fixture('0.7'));
  assert(parsed.srd === undefined, 'a 0.7 file has no srd');
  const opened = await openDocument({ docId: 'srd-old', persist: false, initial: parsed });
  assert(
    JSON.stringify(opened.stores.srd.getSnapshot()) === JSON.stringify(DEFAULT_SRD_DOCUMENT_STATE),
    'the SRD reads as the defaults',
  );
  assert(
    opened.doc.getMap(SRD_MAP).size === 0 && opened.doc.getMap(SRD_FRAMING_MAP).size === 0,
    'nothing is stored for it',
  );
  await opened.close();
}

console.log('=== 3. Save and reload round trip ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  store.applyPreset(AGILE_ENGINEERING_TEMPLATE);
  store.setMetadata({ version: '4.0' });
  store.setFraming('REQ-7', { offsetX: -30, offsetY: 15, zoom: 0.75 });

  const saved = JSON.stringify(fileFrom(doc));
  const reopened = await openDocument({
    docId: 'srd-roundtrip',
    persist: false,
    initial: parseDiagramFile(saved),
  });
  const before = store.getSnapshot();
  const after = reopened.stores.srd.getSnapshot();
  assert(after.presetId === 'agile_engineering', 'preset survives a round trip');
  assert(after.metadata.version === '4.0', 'metadata survives a round trip');
  assert(after.framing['REQ-7']?.offsetX === -30, 'framing survives a round trip');
  assert(
    JSON.stringify(after.settings) === JSON.stringify(before.settings),
    'settings survive a round trip unchanged',
  );
  store.destroy();
  await reopened.close();

  const untouched = new Y.Doc();
  assert(fileFrom(untouched).srd === undefined, 'an untouched SRD adds nothing to the file');
}

console.log('=== 4. Loading a file replaces the SRD too ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  store.setMetadata({ organization: 'Old document' });
  store.setFraming('OLD-1', { offsetX: 1, offsetY: 1, zoom: 2 });

  replaceDocumentContents(doc, parseDiagramFile(fixture('0.8')));
  const srd = store.getSnapshot();
  assert(srd.metadata.organization === 'Fixture Org', "the file's SRD replaces the old one");
  assert(srd.framing['OLD-1'] === undefined, "the old document's framing is gone");
  store.destroy();
}

console.log('=== 5. Rebase keeps the SRD ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  store.updateSettings({ includeComponentTable: true });
  store.setFraming('REQ-1', { offsetX: 5, offsetY: 5, zoom: 1.5 });
  const { doc: rebased } = rebaseDocument(doc);
  const after = createYjsSrdStore(rebased).getSnapshot();
  assert(after.settings.includeComponentTable === true, 'settings survive a rebase');
  assert(after.framing['REQ-1']?.zoom === 1.5, 'framing survives a rebase');
  store.destroy();
}

console.log('=== 6. SRD edits are undoable ===');
{
  const doc = new Y.Doc();
  const undo = createUndoController(doc, { captureTimeout: 0 });
  const store = undoableStore(createYjsSrdStore(doc), undo);
  store.updateSettings({ requirementsLayout: 'list' });
  store.setFraming('REQ-1', { offsetX: 9, offsetY: 9, zoom: 1 });
  undo.undo();
  assert(store.getSnapshot().framing['REQ-1'] === undefined, 'undo reverts framing');
  undo.undo();
  assert(store.getSnapshot().settings.requirementsLayout === 'table', 'undo reverts settings');
  undo.redo();
  assert(store.getSnapshot().settings.requirementsLayout === 'list', 'redo reapplies settings');
  undo.destroy();
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
