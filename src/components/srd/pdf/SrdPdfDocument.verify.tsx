/**
 * The react-pdf SRD: rendered for real, then read back with pdf.js.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/pdf/SrdPdfDocument.verify.tsx
 */
import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { SrdPdfDocument } from './SrdPdfDocument';
import {
  SRD_PDF_FONT_FILES,
  registerSrdPdfFonts,
  resolvePdfFontFamily,
  pdfMonoFamily,
} from './srdPdfFonts';
import { parseMarkdown } from './srdPdfMarkdownTree';
import { aggregateSrdData } from '../../../domain/srd/srdDataAggregator';
import { DEFAULT_SNAPSHOT } from '../../../app/documentSnapshot';
import { DEFAULT_SRD_TEMPLATE } from '../../../domain/srd/srdTemplatePresets';
import type { SrdDataContext, SrdTemplateConfig } from '../../../domain/srd/srdTypes';

/** pdf.js splits letter-spaced and nested text into separately spaced
 * runs; comparing without whitespace tests the content, not the spacing. */
const squash = (text: string) => text.replace(/\s+/g, '');
const has = (text: string, needle: string) => squash(text).includes(squash(needle));

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// A 2x2 PNG, standing in for a captured snapshot.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';

const DESCRIPTION = [
  'This system handles **PAYMENTS-BOLD** and _refunds_.',
  '',
  '- LIST-ONE',
  '- LIST-TWO',
  '',
  '1. ORDERED-ONE',
  '',
  '| Name | Owner |',
  '| ---- | ----- |',
  '| TABLE-CELL-A | team |',
  '',
  'Visit [the portal](https://example.com) or [a script](javascript:alert(1)).',
  '',
  '```',
  'CODE-BLOCK line',
  '```',
  '',
  '<b>RAW-HTML</b>',
].join('\n');

function sampleData(): SrdDataContext {
  const data = aggregateSrdData({
    title: 'Payments Platform',
    nodes: [],
    edges: [],
    doc: DEFAULT_SNAPSHOT.requirements,
    teamDoc: DEFAULT_SNAPSHOT.team,
    diagramImageBase64: PNG,
    metadataOverrides: {
      version: '3.2.1',
      organization: 'Acme Corp',
      description: DESCRIPTION,
    },
  });
  return data;
}

function config(overrides: Partial<SrdTemplateConfig> = {}): SrdTemplateConfig {
  const base = structuredClone(DEFAULT_SRD_TEMPLATE);
  return {
    ...base,
    headersAndFooters: {
      ...base.headersAndFooters,
      classificationBanner: 'Internal Use Only',
      headerLeft: '{{metadata.title}}',
      headerRight: 'Ver {{metadata.version}}',
      footerLeft: '© {{metadata.organization}}',
      footerRight: 'Page {{pageNumber}} of {{totalPages}}',
    },
    // Long intros force several pages.
    sections: base.sections.map((section) => ({
      ...section,
      customIntroText: `INTRO-${section.id} ` + 'Lorem ipsum dolor sit amet. '.repeat(90),
    })),
    ...overrides,
  };
}

async function render(data: SrdDataContext, cfg: SrdTemplateConfig, fontsRegistered: boolean) {
  const blob = await pdf(
    <SrdPdfDocument data={data} config={cfg} fontsRegistered={fontsRegistered} />,
  ).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const raw = new TextDecoder('latin1').decode(bytes);
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages: string[] = [];
  let size = { width: 0, height: 0 };
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    if (i === 1) {
      const [, , width, height] = page.view;
      size = { width, height };
    }
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  const fonts = [...new Set(raw.match(/\/BaseFont\s*\/[A-Z]{6}\+([\w-]+)/g) ?? [])].map(
    (m) => m.split('+')[1],
  );
  return { pages, raw, fonts, size, bytes: blob.size };
}

console.log('=== 1. Font resolution ===');
{
  assert(
    resolvePdfFontFamily('Inter, system-ui, sans-serif', true) === 'Inter',
    'Inter when registered',
  );
  assert(
    resolvePdfFontFamily('Inter, system-ui, sans-serif', false) === 'Helvetica',
    'the next usable entry when Inter is not registered',
  );
  assert(
    resolvePdfFontFamily('"Georgia", serif', true) === 'Times-Roman',
    'serif stacks use Times',
  );
  assert(resolvePdfFontFamily('Comic Neue', true) === 'Helvetica', 'unknown stacks use Helvetica');
  assert(pdfMonoFamily(false) === 'Courier', 'code falls back to Courier');
}

console.log('=== 2. Markdown parsing ===');
{
  const tree = parseMarkdown(DESCRIPTION);
  const types = tree.children.map((n) => n.type);
  assert(types.includes('list') && types.includes('table'), 'lists and GFM tables are parsed');
  assert(types.includes('code'), 'fenced code blocks are parsed');
  assert(JSON.stringify(tree).includes('"type":"html"'), 'raw HTML is parsed (as inline HTML)');
}

// Built-in fonts first: registration is once per process.
const builtin = await render(sampleData(), config(), false);
const fontDir = new URL('../../../../node_modules/@fontsource/', import.meta.url).pathname;
registerSrdPdfFonts((file) => fontDir + file);
const rendered = await render(sampleData(), config(), true);
const { pages } = rendered;
const all = pages.join('\n');
console.log(`(${pages.length} pages, ${Math.round(rendered.bytes / 1024)} KB)`);

console.log('=== 3. Page shell ===');
{
  assert(pages.length >= 3, 'long sections flow across pages');
  assert(
    pages.every((t) => has(t, 'INTERNAL USE ONLY')),
    'the classification banner is on every page, uppercased',
  );
  assert(
    pages.every((t) => has(t, 'Payments Platform') && has(t, 'Ver 3.2.1')),
    'the running header is on every page, with tokens filled in',
  );
  assert(
    pages.every((t, i) => has(t, `Page ${i + 1} of ${pages.length}`) && has(t, '© Acme Corp')),
    'every footer carries its own page number and the total',
  );
  assert(
    Math.round(rendered.size.width) === 612 && Math.round(rendered.size.height) === 792,
    'pages are US Letter portrait',
  );
}

console.log('=== 4. Content ===');
{
  assert(
    has(pages[0], 'Version: 3.2.1') && has(pages[0], 'Organization: Acme Corp'),
    'the title block shows the metadata',
  );
  const order = config()
    .sections.filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order)
    .map((s) => all.indexOf(`INTRO-${s.id}`));
  assert(
    order.every((pos, i) => pos !== -1 && (i === 0 || pos > order[i - 1])),
    'enabled sections appear in order',
  );
  const stranded = config()
    .sections.filter((s) => s.enabled)
    .filter((s) => {
      const heading = pages.findIndex((t) => has(t, s.title));
      const intro = pages.findIndex((t) => t.includes(`INTRO-${s.id}`));
      return heading !== intro;
    })
    .map((s) => s.id);
  assert(stranded.length === 0, `no section heading is separated from its content (${stranded})`);
  const disabled = config().sections.filter((s) => !s.enabled);
  assert(
    disabled.every((s) => !all.includes(`INTRO-${s.id}`)),
    'disabled sections are left out',
  );
  assert(
    ['PAYMENTS-BOLD', 'LIST-ONE', 'ORDERED-ONE', 'TABLE-CELL-A', 'CODE-BLOCK', 'RAW-HTML'].every(
      (t) => all.includes(t),
    ),
    'Markdown content is rendered',
  );
  assert(all.includes('•') && all.includes('1.'), 'list markers are drawn');
  assert(rendered.raw.includes('https://example.com'), 'safe links become PDF links');
  assert(!rendered.raw.includes('javascript:'), 'unsafe links are not linked');
  assert(/\/Subtype\s*\/Image/.test(rendered.raw), 'the architecture diagram is embedded');
}

console.log('=== 5. Fonts ===');
{
  assert(
    ['Inter-Regular', 'Inter-Bold', 'Inter-Italic', 'JetBrainsMono-Regular'].every((f) =>
      rendered.fonts.includes(f),
    ),
    `the registered fonts are embedded (${rendered.fonts.join(', ')})`,
  );
  assert(builtin.fonts.length === 0, 'without registration, only PDF built-in fonts are used');
  assert(builtin.pages.length > 0, 'and the document still renders');
  // WOFF, not WOFF2: fontkit corrupts composite glyphs (©, •) when
  // subsetting WOFF2, crashing the render.
  assert(
    SRD_PDF_FONT_FILES.every((f) => f.file.endsWith('.woff')),
    'font files are WOFF',
  );
}

// react-pdf reports an unwrappable element taller than the page with a
// console warning and then draws it cut off; treat that as a failure.
let oversized = false;
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes("can't wrap between pages")) oversized = true;
  warn(...args);
};

console.log('=== 6. Settings ===');
{
  const landscape = await render(
    sampleData(),
    config({ theme: { ...DEFAULT_SRD_TEMPLATE.theme, pageOrientation: 'landscape' } }),
    true,
  );
  assert(Math.round(landscape.size.width) === 792, 'landscape orientation is applied');
  assert(
    landscape.pages.join(' ').length > 0 && !oversized,
    'in landscape, the diagram still fits on a page',
  );

  const base = config();
  const noNumbers = await render(
    sampleData(),
    config({
      headersAndFooters: {
        ...base.headersAndFooters,
        footerRight: '',
        showPageNumbers: false,
        classificationBanner: '',
      },
    }),
    true,
  );
  assert(!has(noNumbers.pages.join(' '), 'Page 1 of'), 'page numbers can be turned off');
  assert(!has(noNumbers.pages.join(' '), 'INTERNAL USE ONLY'), 'the banner is optional');

  const defaultNumbers = await render(
    sampleData(),
    config({
      headersAndFooters: { ...base.headersAndFooters, footerRight: '', showPageNumbers: true },
    }),
    true,
  );
  assert(
    defaultNumbers.pages.every((t, i) => has(t, `Page ${i + 1} of ${defaultNumbers.pages.length}`)),
    'without a right footer, page numbers default to "Page n of N"',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
