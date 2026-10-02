/**
 * Parity with the export the new engine replaces: for the same document,
 * every word the jsPDF export prints appears in the react-pdf one. Both are
 * read back with pdf.js, so this compares what a reader sees.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/pdf/srdPdfJsPdfParity.verify.tsx
 */
import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { SrdPdfDocument } from './SrdPdfDocument';
import { buildSrdPdf } from '../../../domain/srd/srdPdfExport';
import { config, richData } from './srdPdfTestData';
import type { SrdDataContext, SrdTemplateConfig } from '../../../domain/srd/srdTypes';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

async function pagesOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((x) => ('str' in x ? x.str : '')).join(' '));
  }
  return pages;
}

async function oldExport(data: SrdDataContext, cfg: SrdTemplateConfig): Promise<string[]> {
  const doc = await buildSrdPdf(data, cfg);
  return pagesOf(new Uint8Array(doc.output('arraybuffer')));
}

async function newExport(data: SrdDataContext, cfg: SrdTemplateConfig): Promise<string[]> {
  const blob = await pdf(<SrdPdfDocument data={data} config={cfg} />).toBlob();
  return pagesOf(new Uint8Array(await blob.arrayBuffer()));
}

const squash = (text: string) => text.replace(/\s+/g, '').toUpperCase();

for (const layout of ['list', 'table'] as const) {
  console.log(`=== ${layout} layout ===`);
  const cfg = config({ requirementsLayout: layout });
  const data = richData();
  const [before, after] = [await oldExport(data, cfg), await newExport(data, cfg)];
  const newText = squash(after.join(' '));
  // The old export printed Markdown as written (**bold**); the new one
  // renders it, so the markers are not words to look for.
  const words = before.join(' ').replace(/[*_`]/g, '').split(/\s+/);
  const missing = [...new Set(words)].filter(
    (word) => word && !/^\d+$/.test(word) && !newText.includes(squash(word)),
  );
  assert(
    missing.length === 0,
    `every word of the old export is in the new (${before.length} pages before, ${after.length} after)` +
      (missing.length ? `; missing: ${missing.slice(0, 20).join(' ')}` : ''),
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
