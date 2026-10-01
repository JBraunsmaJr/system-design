/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/collab/stores/srdStore.verify.ts
 */
import * as Y from 'yjs';
import { createYjsSrdStore, seedYjsSrd, SRD_FRAMING_MAP, SRD_MAP } from './yjsSrdStore.ts';
import {
  AGILE_ENGINEERING_TEMPLATE,
  ENTERPRISE_FORMAL_TEMPLATE,
} from '../../domain/srd/srdTemplatePresets.ts';
import {
  CUSTOM_PRESET_ID,
  DEFAULT_SRD_DOCUMENT_STATE,
  srdValuesEqual,
} from '../../domain/srd/srdSettings.ts';
import type { SrdDocumentState } from '../../domain/srd/srdTypes.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const storedKeys = (doc: Y.Doc) => doc.getMap(SRD_MAP).size + doc.getMap(SRD_FRAMING_MAP).size;

/** Exchanges every update between two documents, as a provider would. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

console.log('=== 1. A fresh document reads as the defaults and stores nothing ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  const snap = store.getSnapshot();
  assert(snap.presetId === DEFAULT_SRD_DOCUMENT_STATE.presetId, 'default preset');
  assert(
    JSON.stringify(snap) === JSON.stringify(DEFAULT_SRD_DOCUMENT_STATE),
    'snapshot equals the default state',
  );
  assert(storedKeys(doc) === 0, 'nothing is stored');
  assert(store.getSnapshot() === snap, 'snapshot identity is stable without changes');
  store.destroy();
}

console.log('=== 2. Edits store only differences ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  let notified = 0;
  store.subscribe(() => notified++);

  store.updateSettings({ requirementsLayout: 'list' });
  assert(store.getSnapshot().settings.requirementsLayout === 'list', 'setting is applied');
  assert(store.getSnapshot().presetId === CUSTOM_PRESET_ID, 'a hand edit marks the preset custom');
  assert(doc.getMap(SRD_MAP).has('requirementsLayout'), 'the changed field is stored');
  assert(!doc.getMap(SRD_MAP).has('theme'), 'unchanged fields are not stored');
  assert(notified === 1, 'one edit notifies once');

  store.applyPreset(ENTERPRISE_FORMAL_TEMPLATE);
  assert(storedKeys(doc) === 0, 'returning to the default preset removes every stored key');

  store.updateSettings({ theme: store.getSnapshot().settings.theme });
  assert(!doc.getMap(SRD_MAP).has('theme'), 'writing a value equal to the default stores nothing');
  assert(
    store.getSnapshot().presetId === ENTERPRISE_FORMAL_TEMPLATE.id,
    'an edit that changes nothing keeps the preset',
  );

  const before = notified;
  store.applyPreset(ENTERPRISE_FORMAL_TEMPLATE);
  assert(notified === before, 'a write that changes nothing does not notify');
  store.destroy();
}

console.log('=== 3. Presets, metadata and framing ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  store.setMetadata({ organization: 'Acme' });
  store.setFraming('REQ-1', { offsetX: 12, offsetY: 0, zoom: 1.5 });
  store.applyPreset(AGILE_ENGINEERING_TEMPLATE);

  const snap = store.getSnapshot();
  assert(snap.presetId === 'agile_engineering', 'preset id is stored');
  assert(snap.settings.requirementsLayout === 'list', "preset's settings are stored");
  assert(snap.metadata.organization === 'Acme', 'applying a preset keeps metadata');
  assert(snap.framing['REQ-1']?.offsetX === 12, 'applying a preset keeps framing');

  store.setFraming('REQ-1', null);
  assert(store.getSnapshot().framing['REQ-1'] === undefined, 'null restores default framing');
  assert(doc.getMap(SRD_FRAMING_MAP).size === 0, 'default framing is not stored');

  store.setFraming('REQ-2', { offsetX: 0, offsetY: 0, zoom: 1, hidden: true });
  assert(store.getSnapshot().framing['REQ-2']?.hidden === true, 'hiding a snapshot is stored');
  store.destroy();
}

console.log('=== 4. Unchanged parts keep their identity ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  store.updateSettings({ requirementsLayout: 'list' });
  const before = store.getSnapshot();
  store.setFraming('REQ-1', { offsetX: 5, offsetY: 5, zoom: 1 });
  const afterFraming = store.getSnapshot();
  assert(afterFraming !== before, 'a framing change produces a new snapshot');
  assert(afterFraming.settings === before.settings, 'settings keep their identity');
  assert(afterFraming.metadata === before.metadata, 'metadata keeps its identity');

  store.setMetadata({ version: '9' });
  const afterMetadata = store.getSnapshot();
  assert(afterMetadata.framing === afterFraming.framing, 'framing keeps its identity');
  assert(afterMetadata.settings === afterFraming.settings, 'settings still keep their identity');
  store.destroy();
}

console.log('=== 5. Concurrent edits to different fields both survive ===');
{
  const a = new Y.Doc();
  const b = new Y.Doc();
  const storeA = createYjsSrdStore(a);
  const storeB = createYjsSrdStore(b);

  storeA.updateSettings({
    theme: { ...storeA.getSnapshot().settings.theme, primaryColor: '#111111' },
  });
  storeB.updateSettings({
    sections: storeB.getSnapshot().settings.sections.map((s) => ({ ...s, enabled: false })),
  });
  storeA.setFraming('REQ-1', { offsetX: 1, offsetY: 1, zoom: 1 });
  storeB.setFraming('REQ-2', { offsetX: 2, offsetY: 2, zoom: 1 });
  sync(a, b);

  for (const [name, store] of [
    ['peer A', storeA],
    ['peer B', storeB],
  ] as const) {
    const snap = store.getSnapshot();
    assert(snap.settings.theme.primaryColor === '#111111', `${name} has A's theme`);
    assert(
      snap.settings.sections.every((s) => !s.enabled),
      `${name} has B's sections`,
    );
    assert(
      snap.framing['REQ-1'] !== undefined && snap.framing['REQ-2'] !== undefined,
      `${name} has both peers' framing`,
    );
  }
  // Structural: Y.Map iteration order is per replica, so key order may differ.
  assert(
    srdValuesEqual(storeA.getSnapshot(), storeB.getSnapshot()),
    'both peers converge on the same SRD',
  );
  storeA.destroy();
  storeB.destroy();
}

console.log('=== 6. Hostile values from a peer are sanitized on read ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  doc.transact(() => {
    doc.getMap(SRD_MAP).set('theme', { primaryColor: 'red;}body{display:none' });
    doc.getMap(SRD_MAP).set('templateId', 'unknown-template');
    doc.getMap(SRD_FRAMING_MAP).set('REQ-1', { offsetX: 'NaN', offsetY: 0, zoom: 1 });
  });
  const snap = store.getSnapshot();
  assert(
    snap.settings.theme.primaryColor === DEFAULT_SRD_DOCUMENT_STATE.settings.theme.primaryColor,
    'an injected color reads as the default',
  );
  assert(snap.templateId === 'classic', 'an unknown template reads as classic');
  assert(snap.framing['REQ-1'] === undefined, 'malformed framing is ignored');
  store.destroy();
}

console.log('=== 7. Seeding fills only what is missing ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  store.updateSettings({ requirementsLayout: 'list' });

  const incoming: SrdDocumentState = {
    ...structuredClone(DEFAULT_SRD_DOCUMENT_STATE),
    settings: {
      ...structuredClone(DEFAULT_SRD_DOCUMENT_STATE.settings),
      requirementsLayout: 'table',
      includeComponentTable: true,
    },
    framing: { 'REQ-9': { offsetX: 3, offsetY: 3, zoom: 2 } },
  };
  seedYjsSrd(doc, incoming);
  const snap = store.getSnapshot();
  assert(snap.settings.requirementsLayout === 'list', 'an existing field is not overwritten');
  assert(snap.settings.includeComponentTable === true, 'a missing field is filled');
  assert(snap.framing['REQ-9']?.zoom === 2, 'missing framing is filled');

  const empty = new Y.Doc();
  seedYjsSrd(empty, structuredClone(DEFAULT_SRD_DOCUMENT_STATE));
  assert(storedKeys(empty) === 0, 'seeding a default SRD stores nothing');
  store.destroy();
}

console.log('=== 8. destroy detaches ===');
{
  const doc = new Y.Doc();
  const store = createYjsSrdStore(doc);
  let notified = 0;
  store.subscribe(() => notified++);
  store.destroy();
  doc.getMap(SRD_MAP).set('requirementsLayout', 'list');
  assert(notified === 0, 'no notifications after destroy');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
