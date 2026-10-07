/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/srd/srdSettings.verify.ts
 */
import {
  applyMetadataOverrides,
  compactSrdState,
  CUSTOM_PRESET_ID,
  DEFAULT_SNAPSHOT_FRAMING,
  DEFAULT_SRD_DOCUMENT_STATE,
  expandSrdFileValue,
  framingFor,
  isCapturedWith,
  readSrdField,
  stateWithPreset,
  toRenderConfig,
} from './srdSettings';
import {AGILE_ENGINEERING_TEMPLATE, ENTERPRISE_FORMAL_TEMPLATE} from './srdTemplatePresets';
import type {SrdDataContext, SrdDocumentState} from './srdTypes';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

console.log('=== 1. Defaults ===');
{
  const d = DEFAULT_SRD_DOCUMENT_STATE;
  assert(d.templateId === 'classic', 'default template is classic');
  assert(d.presetId === ENTERPRISE_FORMAL_TEMPLATE.id, 'default preset is Enterprise Formal');
  assert(
    d.settings.theme.primaryColor === ENTERPRISE_FORMAL_TEMPLATE.theme.primaryColor,
    'default settings come from the default preset',
  );
  assert(Object.isFrozen(d.settings.theme), 'defaults are deeply frozen');
  assert(compactSrdState(d) === undefined, 'an all-default state compacts to nothing');
}

console.log('=== 2. Compact and expand round trip ===');
{
  const state: SrdDocumentState = clone(DEFAULT_SRD_DOCUMENT_STATE);
  state.settings.theme.primaryColor = '#123456';
  state.metadata = { version: '2.0' };
  state.framing = {
    'REQ-1': { offsetX: 10, offsetY: -5, zoom: 1.5 },
    'REQ-2': { ...DEFAULT_SNAPSHOT_FRAMING },
  };
  const compact = compactSrdState(state)!;
  assert(compact !== undefined, 'a changed state compacts to a value');
  assert(compact.theme?.primaryColor === '#123456', 'the changed field is kept');
  assert(compact.sections === undefined, 'unchanged fields are omitted');
  assert(compact.presetId === undefined, 'an unchanged preset id is omitted');
  assert(
    compact.framing !== undefined && Object.keys(compact.framing).join() === 'REQ-1',
    'only non-default framing is kept',
  );

  const expanded = expandSrdFileValue(JSON.parse(JSON.stringify(compact)));
  assert(expanded.settings.theme.primaryColor === '#123456', 'expanded theme matches');
  assert(expanded.metadata.version === '2.0', 'expanded metadata matches');
  assert(expanded.framing['REQ-1']?.zoom === 1.5, 'expanded framing matches');
  assert(
    JSON.stringify(expanded.settings.sections) ===
      JSON.stringify(DEFAULT_SRD_DOCUMENT_STATE.settings.sections),
    'absent fields expand to defaults',
  );
}

console.log('=== 3. Untrusted input is sanitized field by field ===');
{
  const theme = readSrdField('theme', {
    primaryColor: 'red; background: url(evil)',
    accentColor: '#abcdef',
    fontFamily: 'x}; body{display:none',
  });
  assert(
    theme.primaryColor === DEFAULT_SRD_DOCUMENT_STATE.settings.theme.primaryColor,
    'a CSS-injecting color falls back to the default',
  );
  assert(theme.accentColor === '#abcdef', 'a valid sibling field is kept');
  assert(
    theme.fontFamily === DEFAULT_SRD_DOCUMENT_STATE.settings.theme.fontFamily,
    'an injecting font family falls back to the default',
  );

  assert(
    readSrdField('templateId', 'from-a-newer-build') === 'classic',
    'an unknown template id falls back to classic',
  );
  assert(readSrdField('requirementsLayout', 'grid') === 'table', 'an unknown layout falls back');

  const sections = readSrdField('sections', [
    { id: 'roadmap', title: 'Roadmap', enabled: false, order: 1 },
    { id: 'roadmap', title: 'Duplicate', enabled: true, order: 2 },
    { id: 'not-a-section', title: 'Unknown', enabled: true, order: 3 },
    'garbage',
  ]);
  assert(sections.length === 1, 'duplicate, unknown and malformed sections are dropped');
  assert(sections[0].enabled === false, 'a valid section keeps its values');

  const expanded = expandSrdFileValue({
    framing: {
      a: { offsetX: 1e9, offsetY: 0, zoom: 1000 },
      b: { offsetX: 'x', offsetY: 0, zoom: 1 },
    },
  });
  assert(expanded.framing.a?.offsetX === 10_000, 'framing offsets are clamped');
  assert(expanded.framing.a?.zoom === 10, 'framing zoom is clamped');
  assert(expanded.framing.b === undefined, 'malformed framing is dropped');

  const fromJunk = expandSrdFileValue('not an object');
  assert(
    JSON.stringify(fromJunk) === JSON.stringify(DEFAULT_SRD_DOCUMENT_STATE),
    'a junk file value reads as the defaults',
  );
}

console.log('=== 4. Presets ===');
{
  const base: SrdDocumentState = {
    ...clone(DEFAULT_SRD_DOCUMENT_STATE),
    metadata: { organization: 'Acme' },
    framing: { 'REQ-1': { offsetX: 3, offsetY: 4, zoom: 2 } },
  };
  const applied = stateWithPreset(base, AGILE_ENGINEERING_TEMPLATE);
  assert(applied.presetId === 'agile_engineering', 'applying a preset records its id');
  assert(applied.settings.requirementsLayout === 'list', "the preset's settings are applied");
  assert(applied.metadata.organization === 'Acme', 'metadata is kept');
  assert(applied.framing['REQ-1']?.zoom === 2, 'framing is kept');

  const imported = stateWithPreset(base, AGILE_ENGINEERING_TEMPLATE, CUSTOM_PRESET_ID);
  assert(imported.presetId === CUSTOM_PRESET_ID, 'an imported template can be marked custom');

  assert(toRenderConfig(applied).name === 'Agile Engineering', 'render config names the preset');
  assert(toRenderConfig(imported).name === 'Custom', 'a custom state renders as Custom');
}

console.log('=== 5. Applying state to SRD data ===');
{
  const data = { metadata: { title: 'Derived', version: '1.0' } } as unknown as SrdDataContext;
  assert(applyMetadataOverrides(data, {}) === data, 'no overrides keeps the same object');
  const applied = applyMetadataOverrides(data, { version: '3.1' });
  assert(applied.metadata.version === '3.1', 'an override replaces the derived value');
  assert(applied.metadata.title === 'Derived', 'other derived values are kept');

  const state = clone(DEFAULT_SRD_DOCUMENT_STATE);
  assert(framingFor(state, 'missing') === DEFAULT_SNAPSHOT_FRAMING, 'missing framing is default');

  const framing = { offsetX: 1, offsetY: 2, zoom: 1.25 };
  assert(
    isCapturedWith({ contextSnapshotBase64: 'data:', snapshotFraming: framing }, framing),
    'a snapshot taken with the framing matches it',
  );
  assert(
    !isCapturedWith({ contextSnapshotBase64: undefined, snapshotFraming: framing }, framing),
    'a missing image never matches',
  );
  assert(
    isCapturedWith(
      { contextSnapshotBase64: 'data:', snapshotFraming: framing },
      { ...framing, hidden: true },
    ),
    'visibility is not part of the image',
  );
}

console.log('=== 6. A template this build does not have ===');
{
  const fromNewer = expandSrdFileValue({ templateId: 'holographic' });
  assert(fromNewer.templateId === 'classic', 'it draws with the default meanwhile');
  assert(fromNewer.unsupportedTemplateId === 'holographic', 'and is reported, by name');
  assert(
    compactSrdState(fromNewer)?.templateId === 'holographic',
    'and saving writes it back unchanged, not the default',
  );
  const known = expandSrdFileValue({ templateId: 'engineering' });
  assert(
    known.templateId === 'engineering' && known.unsupportedTemplateId === undefined,
    'a known template is simply used',
  );
  assert(
    expandSrdFileValue({ templateId: 42 }).unsupportedTemplateId === undefined,
    'a value that is not a name is not reported as one',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
