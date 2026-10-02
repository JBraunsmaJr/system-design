/**
 * The same document renders to the same PDF - byte for byte - every time and
 * for every collaborator. That is the guarantee behind sharing the SRD's
 * settings in the document: no one prints something different.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/pdf/srdPdfDeterminism.verify.tsx
 */
import { pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as Y from 'yjs';
import { SrdPdfDocument } from './SrdPdfDocument';
import { registerSrdPdfFonts } from './srdPdfFonts';
import { createYjsSrdStore } from '../../../collab/stores/yjsSrdStore';
import { aggregateSrdData } from '../../../domain/srd/srdDataAggregator';
import {
  applyDocumentState,
  settingsFromPreset,
  toRenderConfig,
} from '../../../domain/srd/srdSettings';
import { AGILE_ENGINEERING_TEMPLATE } from '../../../domain/srd/srdTemplatePresets';
import { DEFAULT_SNAPSHOT } from '../../../app/documentSnapshot';
import type { SrdDataContext, SrdTemplateConfig } from '../../../domain/srd/srdTypes';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// The real fonts: subsetting must be deterministic too. (See
// SrdPdfDocument.verify.tsx for why the path is converted by hand.)
const fontDir = decodeURIComponent(
  new URL('../../../../node_modules/@fontsource/', import.meta.url).pathname,
).replace(/^\/([A-Za-z]:\/)/, '$1');
registerSrdPdfFonts((file) => fontDir + file);

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';

async function bytesOf(data: SrdDataContext, config: SrdTemplateConfig): Promise<Uint8Array> {
  const blob = await pdf(<SrdPdfDocument data={data} config={config} fontsRegistered />).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

/** The PDF's text, read back: fonts are subset, so it is not in the bytes. */
async function textOf(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((x) => ('str' in x ? x.str : '')).join(' '));
  }
  return pages.join(' ').replace(/\s+/g, '');
}

/** Every fill and stroke color drawn, as hex - content streams are
 * compressed, so colors are read through pdf.js rather than the bytes. */
async function colorsOf(bytes: Uint8Array): Promise<Set<string>> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const colors = new Set<string>();
  for (let i = 1; i <= doc.numPages; i++) {
    const ops = await (await doc.getPage(i)).getOperatorList();
    ops.fnArray.forEach((fn, n) => {
      if (fn === OPS.setFillRGBColor || fn === OPS.setStrokeRGBColor) {
        colors.add(String(ops.argsArray[n][0]).toLowerCase());
      }
    });
  }
  return colors;
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

function aggregated(): SrdDataContext {
  return aggregateSrdData({
    title: 'Payments Platform',
    nodes: [],
    edges: [],
    doc: DEFAULT_SNAPSHOT.requirements,
    teamDoc: DEFAULT_SNAPSHOT.team,
    diagramImageBase64: PNG,
    metadataOverrides: { generatedAt: '2026-10-01', description: 'Handles **payments**.' },
  });
}

console.log('=== 1. Rendering twice gives identical bytes ===');
{
  const data = aggregated();
  const config = toRenderConfig({
    presetId: AGILE_ENGINEERING_TEMPLATE.id,
    templateId: 'classic',
    settings: settingsFromPreset(AGILE_ENGINEERING_TEMPLATE),
  });
  const first = await bytesOf(data, config);
  // Past a second boundary, where an embedded clock time would change.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = await bytesOf(structuredClone(data), structuredClone(config));
  const at = firstDifference(first, second);
  assert(
    at === -1,
    `identical across renders${at === -1 ? '' : ` (first difference at byte ${at})`}`,
  );

  const raw = new TextDecoder('latin1').decode(first);
  assert(raw.includes('(D:20261001000000Z)'), "the PDF is dated with the document's own date");
}

console.log('=== 2. Two collaborators print identical PDFs ===');
{
  // Two replicas of one document, edited in turn: one person applies a
  // preset and edits metadata; once that has synced, the other changes the
  // theme. (Edits at the same moment to the same field resolve
  // last-writer-wins by design, so they would make "whose edit shows" depend
  // on random replica ids - covered by the store's own tests, not here.)
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const storeA = createYjsSrdStore(docA);
  const storeB = createYjsSrdStore(docB);
  const sync = () => {
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)));
  };
  storeA.applyPreset(AGILE_ENGINEERING_TEMPLATE);
  storeA.setMetadata({ organization: 'Acme Corp', version: '3.1' });
  sync();
  storeB.updateSettings({
    theme: { ...storeB.getSnapshot().settings.theme, primaryColor: '#7c3aed' },
  });
  sync();

  const render = (store: typeof storeA) => {
    const state = store.getSnapshot();
    return bytesOf(applyDocumentState(aggregated(), state), toRenderConfig(state));
  };
  const [a, b] = [await render(storeA), await render(storeB)];
  const at = firstDifference(a, b);
  assert(
    at === -1,
    `both collaborators' PDFs are byte-identical${at === -1 ? '' : ` (differ at ${at})`}`,
  );
  const text = await textOf(a);
  const preset = settingsFromPreset(AGILE_ENGINEERING_TEMPLATE);
  const firstSection = [...preset.sections]
    .filter((x) => x.enabled)
    .sort((x, y) => x.order - y.order)[0];
  assert(
    text.includes('AcmeCorp') &&
      text.includes('Version:3.1') &&
      text.includes(firstSection.title.replace(/\s+/g, '')),
    "they carry the first collaborator's preset and metadata",
  );
  assert((await colorsOf(a)).has('#7c3aed'), "and the second collaborator's theme color");

  // Before syncing, they would differ - the check above is not vacuous.
  const docC = new Y.Doc();
  const storeC = createYjsSrdStore(docC);
  storeC.updateSettings({ requirementsLayout: 'list' });
  const c = await render(storeC);
  assert(firstDifference(a, c) !== -1, 'a replica with different settings prints differently');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
