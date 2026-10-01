/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/SrdView.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import * as Y from 'yjs';
import SrdView, { type SrdViewProps } from './SrdView';
import { createYjsSrdStore } from '../../collab/stores/yjsSrdStore';
import { DEFAULT_SNAPSHOT } from '../../app/documentSnapshot';
import { AGILE_ENGINEERING_TEMPLATE } from '../../domain/srd/srdTemplatePresets';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const propsFor = (srdStore = createYjsSrdStore(new Y.Doc())): SrdViewProps => ({
  srdStore,
  title: 'Payments Platform',
  diagramSnapshot: { nodes: [], edges: [] },
  requirementsSnapshot: DEFAULT_SNAPSHOT.requirements,
  milestonesSnapshot: DEFAULT_SNAPSHOT.milestones,
  programIncrementsSnapshot: DEFAULT_SNAPSHOT.programIncrements,
  teamSnapshot: DEFAULT_SNAPSHOT.team,
});

// 1. A view, not a modal
{
  const html = renderToStaticMarkup(<SrdView {...propsFor()} />);
  assert(html.includes('class="srd-view"'), 'Renders as a view');
  assert(!html.includes('srd-modal'), 'Has no modal backdrop or dialog');
  assert(!html.includes('Close modal'), 'Has no close button to dismiss by accident');
  assert(html.includes('srd-preview-paper'), 'Renders the document preview');
  assert(html.includes('srd-capture-surface'), 'Mounts the offscreen capture surface');
  assert(html.includes('Payments Platform'), "Content is derived from the document's title");
}

// 2. It renders the document's SRD state, not its own defaults
{
  const store = createYjsSrdStore(new Y.Doc());
  store.setMetadata({ organization: 'Shared Org From The Document' });
  store.updateSettings({
    theme: { ...store.getSnapshot().settings.theme, primaryColor: '#abcdef' },
  });
  const html = renderToStaticMarkup(<SrdView {...propsFor(store)} />);
  assert(html.includes('Shared Org From The Document'), "Renders the document's metadata");
  assert(html.includes('#abcdef'), "Renders the document's theme");
  assert(html.includes('Custom Configuration'), 'A hand-edited SRD shows as custom');
}

// 3. A preset applied by anyone shows for everyone
{
  const store = createYjsSrdStore(new Y.Doc());
  store.applyPreset(AGILE_ENGINEERING_TEMPLATE);
  const html = renderToStaticMarkup(<SrdView {...propsFor(store)} />);
  assert(
    /<option value="agile_engineering" selected="">/.test(html),
    "The document's preset is selected",
  );
}

// 4. A removed diagram offers to restore it
{
  const store = createYjsSrdStore(new Y.Doc());
  store.setFraming('@diagram', { offsetX: 0, offsetY: 0, zoom: 1, hidden: true });
  const html = renderToStaticMarkup(<SrdView {...propsFor(store)} />);
  assert(html.includes('Restore Diagram'), 'A removed diagram can be restored');
  assert(!html.includes('Refresh Snapshot'), 'and is not offered for refresh');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
