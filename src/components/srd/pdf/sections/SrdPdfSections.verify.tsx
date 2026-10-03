/**
 * The shared section renderers through every template: all of the
 * document's content shown, pagination of long content, empty states,
 * settings, and the template registry. *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/pdf/sections/SrdPdfSections.verify.tsx
 */
import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { SrdPdfDocument } from '../SrdPdfDocument';
import { SRD_PDF_TEMPLATES, pdfTemplateFor } from '../templates';
import { PDF_FONT_MONO } from '../srdPdfFonts';
import { DEFAULT_SRD_TEMPLATE } from '../../../../domain/srd/srdTemplatePresets';
import type { SrdDataContext, SrdTemplateConfig } from '../../../../domain/srd/srdTypes';
import { config, richData } from '../srdPdfTestData';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const squash = (text: string) => text.replace(/\s+/g, '');
// react-pdf reports an unwrappable element taller than a page with a
// warning, then draws it cut off; any such warning fails the run.
const oversized: string[] = [];
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes("can't wrap between pages")) oversized.push(String(args[0]));
  else warn(...args);
};

async function pdfPages(data: SrdDataContext, cfg: SrdTemplateConfig): Promise<string[]> {
  const blob = await pdf(<SrdPdfDocument data={data} config={cfg} />).toBlob();
  const doc = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()), verbosity: 0 })
    .promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((x) => ('str' in x ? x.str : '')).join(' '));
  }
  return pages;
}

/**
 * Everything the document's data says that a reader should see, for one
 * layout: titles, metadata, every component, connection, requirement,
 * relationship, milestone and sprint. Cards show more than table rows (the
 * sprint, linked components, the body), so those are expected in cards only.
 */
function expectedContent(data: SrdDataContext, cfg: SrdTemplateConfig): string[] {
  const { metadata, architecture, requirements, traceability, roadmap } = data;
  const cards = cfg.requirementsLayout === 'list';
  const items = requirements.categories.flatMap((c) => requirements.itemsByCategory[c.id] ?? []);
  const shownCategories = requirements.categories.filter(
    (c) => (requirements.itemsByCategory[c.id] ?? []).length > 0,
  );
  const sections = cfg.sections.filter((x) => x.enabled);
  return [
    metadata.title,
    metadata.version,
    metadata.generatedAt,
    metadata.organization ?? '',
    ...metadata.authors.map((a) => a.name),
    'card payments',
    'Fraud checks',
    'Settlement',
    ...sections.flatMap((x) => [x.title, x.customIntroText ?? '']),
    ...(cfg.includeComponentTable
      ? architecture.components.flatMap((c) => [c.name, c.type, c.description ?? ''])
      : []),
    ...(cfg.includeConnectionsTable
      ? architecture.connections.flatMap((c) => [c.label ?? '', c.protocol ?? c.edgeType ?? ''])
      : []),
    ...shownCategories.map((c) => `Category: ${c.label}`),
    ...items.flatMap((item) => [
      item.id,
      item.title,
      item.typeLabel,
      item.status ?? '',
      item.assigneeName ?? '',
      ...(cards ? [item.sprintName ?? '', ...(item.linkedNodeLabels ?? [])] : []),
    ]),
    ...traceability.flatMap((t) => [t.relation, t.sourceTitle, t.targetTitle]),
    ...roadmap.milestones.flatMap((m) => [
      m.title,
      m.type,
      m.targetDate ?? '',
      m.description ?? '',
    ]),
    ...roadmap.sprints.flatMap((x) => [x.piName, x.name, x.startDate, x.endDate]),
  ].filter((text) => text.length > 0);
}

console.log('=== 1. Every template shows all of the document ===');
const TEMPLATE_IDS = Object.keys(SRD_PDF_TEMPLATES) as Array<keyof typeof SRD_PDF_TEMPLATES>;

for (const templateId of TEMPLATE_IDS)
  for (const layout of ['list', 'table'] as const) {
    const cfg = config({ requirementsLayout: layout, templateId });
    const data = richData();
    const pdfText = squash((await pdfPages(data, cfg)).join(' ')).toUpperCase();
    const missing = expectedContent(data, cfg).filter(
      (text) => !pdfText.includes(squash(text).toUpperCase()),
    );
    assert(
      missing.length === 0,
      `${templateId}, ${layout} layout: all of the document's content is in the PDF${missing.length ? ` (missing: ${missing.slice(0, 10).join(' | ')})` : ''}`,
    );
  }

console.log('=== 2. Long content paginates cleanly ===');
{
  const cfg = config({ requirementsLayout: 'list' });
  const data = richData({ components: 70, items: 14 });
  // A requirement with a body far longer than a page must flow on.
  data.requirements.itemsByCategory.sec[0].body = Array.from(
    { length: 120 },
    (_, i) => `Paragraph ${i} of a very long requirement body.`,
  ).join('\n\n');
  const pages = await pdfPages(data, cfg);
  console.log(`(${pages.length} pages)`);

  const tablePages = pages.filter((t) => /Responsibility of component \d+/.test(t));
  assert(tablePages.length >= 2, `the component table spans pages (${tablePages.length})`);
  assert(
    tablePages.every((t) => t.includes('Component Name')),
    'its header row repeats on every page it spans',
  );
  const rows = pages.join(' ').match(/Responsibility of component \d+/g) ?? [];
  assert(rows.length === 70, `no component row is lost or duplicated (${rows.length}/70)`);

  const splitHeads = data.requirements.categories
    .flatMap((c) => data.requirements.itemsByCategory[c.id] ?? [])
    .filter((it) => {
      const idPage = pages.findIndex((t) => squash(t).includes(squash(it.title)));
      const pillPage = pages.findIndex((t) => t.includes(it.sprintName!));
      return idPage !== pillPage;
    })
    .map((it) => it.id);
  assert(splitHeads.length === 0, `every card's head stays on one page (split: ${splitHeads})`);
  assert(
    pages.some((t) => t.includes('Paragraph 0 ')) &&
      pages.findIndex((t) => t.includes('Paragraph 0 ')) !==
        pages.findIndex((t) => t.includes('Paragraph 119 ')),
    'a body longer than a page flows onto the next',
  );
  assert(oversized.length === 0, `nothing is too tall to fit a page (${oversized.length})`);

  // Each subheading shares a page with what follows it. (react-pdf keeps a
  // heading with its content only when the heading has earlier siblings; a
  // heading first in a wrapper View is silently left at a page's bottom.)
  const followedBy: Array<[string, string]> = [
    ['Component Inventory', 'Component Name'],
    ['Connections & Data Flows', 'Flow Label'],
    ['Category: Security', 'Requirement title 1 end'],
    ['Milestones', 'Target Date'],
    ['Program Increments & Sprints', 'Timeline'],
  ];
  // Searched from the roadmap section on for its subheadings: the executive
  // summary's metrics also mention milestones.
  const roadmapTitle = cfg.sections.find((x) => x.id === 'roadmap')!.title;
  const roadmapPage = pages.findIndex((t) => squash(t).includes(squash(roadmapTitle)));
  const separated = followedBy.filter(([heading, next]) => {
    const from = ['Milestones', 'Program Increments & Sprints'].includes(heading) ? roadmapPage : 0;
    const at = pages.findIndex((t, i) => i >= from && squash(t).includes(squash(heading)));
    return at === -1 || !squash(pages[at]).includes(squash(next));
  });
  assert(
    separated.length === 0,
    `every subheading shares a page with its content (${separated.map(([h]) => h).join(', ')})`,
  );
}

console.log('=== 2b. A category heading stays with its first card ===');
{
  // The shape that stranded "Category: Security" in the browser: landscape,
  // the diagram pushed to a page of its own, then cards whose unsplittable
  // heads (with snapshots) are far taller than a heading's usual keep.
  const cfg = config({
    requirementsLayout: 'list',
    theme: { ...DEFAULT_SRD_TEMPLATE.theme, pageOrientation: 'landscape' },
  });
  for (const filler of [0, 20, 40, 60, 80]) {
    const data = richData({ components: 2, items: 4 });
    // Shift where the requirements section starts, to land the category
    // heading at every height on a page.
    data.metadata.description = 'Filler line.\n\n'.repeat(filler);
    const pages = await pdfPages(data, cfg);
    for (const category of data.requirements.categories) {
      const first = data.requirements.itemsByCategory[category.id]?.[0];
      if (!first) continue;
      const heading = pages.findIndex((t) =>
        squash(t).includes(squash(`Category: ${category.label}`)),
      );
      const card = pages.findIndex((t) => squash(t).includes(squash(first.title)));
      if (heading !== card) {
        assert(
          false,
          `"Category: ${category.label}" is with its first card (filler ${filler}: pages ${heading}/${card})`,
        );
      }
    }
  }
  assert(true, 'category headings stay with their first card at every position tried');
}

console.log('=== 2c. A short table starts with its heading and first row ===');
{
  // A table of up to REPEAT_HEADER_AFTER_ROWS rows keeps its heading, header
  // row and first row together, so none is ever left at a page's bottom.
  const cfg = config({
    requirementsLayout: 'table',
    theme: { ...DEFAULT_SRD_TEMPLATE.theme, pageOrientation: 'landscape' },
  });
  let separated = 0;
  for (const filler of [0, 10, 20, 30, 40, 50, 60]) {
    const data = richData({ components: 2, items: 8 });
    data.metadata.description = 'Filler line.\n\n'.repeat(filler + 1);
    const pages = await pdfPages(data, cfg);
    for (const category of data.requirements.categories) {
      const first = data.requirements.itemsByCategory[category.id]?.[0];
      if (!first) continue;
      const heading = pages.findIndex((t) =>
        squash(t).includes(squash(`Category: ${category.label}`)),
      );
      const page = heading === -1 ? '' : squash(pages[heading]);
      if (
        !page.includes('IDTitleTypeStatusEffortAssignee') ||
        !page.includes(squash(first.title))
      ) {
        separated++;
        console.error(
          `  "Category: ${category.label}" starts apart from its rows (filler ${filler})`,
        );
      }
    }
  }
  assert(separated === 0, 'short tables start with heading, header row and first row together');
}

console.log('=== 2d. A section heading stays with its first block ===');
{
  // A section's heading and introduction travel inside its first block, so
  // they are never left at a page's bottom when that block moves on.
  const firstBlock: Record<string, string> = {
    executive_summary: 'Scope & Objectives',
    architecture: 'System Architecture Diagram',
    requirements: 'Category: Security',
    traceability: 'Source Entity',
    roadmap: 'Target Date',
  };
  let separated = 0;
  for (const templateId of TEMPLATE_IDS)
    for (const layout of ['list', 'table'] as const) {
      const cfg = config({
        requirementsLayout: layout,
        templateId,
        theme: { ...DEFAULT_SRD_TEMPLATE.theme, pageOrientation: 'landscape' },
      });
      // Every position for Classic; a sample for the others, to keep this quick.
      for (const filler of templateId === 'classic' ? [0, 15, 30, 45] : [0, 30]) {
        const data = richData({ components: 3, items: 4 });
        data.metadata.description = 'Filler line.\n\n'.repeat(filler + 1);
        const pages = await pdfPages(data, cfg);
        for (const section of cfg.sections.filter((x) => x.enabled)) {
          const at = pages.findIndex((t) =>
            squash(t).toUpperCase().includes(squash(section.title).toUpperCase()),
          );
          // Case-insensitive: a template may set headings in capitals.
          if (
            at === -1 ||
            !squash(pages[at]).toUpperCase().includes(squash(firstBlock[section.id]).toUpperCase())
          ) {
            separated++;
            console.error(
              `  "${section.title}" is apart from its first block (${templateId}, ${layout}, filler ${filler})`,
            );
          }
        }
      }
    }
  assert(separated === 0, 'every section heading shares a page with its first block');
}

console.log('=== 2e. Engineering: each section on pages of its own ===');
{
  const cfg = config({ requirementsLayout: 'list', templateId: 'engineering' });
  const pages = await pdfPages(richData(), cfg);
  const titles = cfg.sections
    .filter((x) => x.enabled)
    .sort((a, b) => a.order - b.order)
    .map((x) => squash(x.title).toUpperCase());
  const starts = titles.map((t) => pages.findIndex((p) => squash(p).toUpperCase().includes(t)));
  assert(
    starts.every((page, i) => page !== -1 && (i === 0 || page > starts[i - 1])) &&
      new Set(starts).size === starts.length,
    `every section starts a page no other section starts on (pages ${starts.map((p) => p + 1).join(', ')})`,
  );
  assert(
    pages.every((t, i) => squash(t).includes(squash(`Page ${i + 1} of ${pages.length}`))),
    'page numbers run on across the sections pages',
  );
}

console.log('=== 3. Empty states and settings ===');
{
  const empty = richData();
  empty.architecture.components = [];
  empty.architecture.connections = [];
  empty.traceability = [];
  empty.roadmap.milestones = [];
  empty.roadmap.sprints = [];
  const text = (await pdfPages(empty, config())).join(' ');
  for (const note of [
    'No architecture components defined in canvas.',
    'No connections defined between components.',
    'No relationships or architecture linkages established.',
    'No milestones scheduled.',
    'No sprint iterations planned.',
  ]) {
    assert(squash(text).includes(squash(note)), `empty state: "${note}"`);
  }

  const off = (
    await pdfPages(
      richData(),
      config({ includeComponentTable: false, includeConnectionsTable: false }),
    )
  ).join(' ');
  assert(!off.includes('Component Inventory'), 'the component table can be turned off');
  assert(!off.includes('Connections & Data Flows'), 'the connections table can be turned off');
  assert(!off.includes('Category: Unused'), 'a category with no items is left out');

  const table = (await pdfPages(richData(), config({ requirementsLayout: 'table' }))).join(' ');
  assert(
    table.includes('Assignee') && !table.includes('Architecture Context Snapshot'),
    'the table layout lists items without cards',
  );
}

console.log('=== 4. Template registry ===');
{
  assert(
    Object.entries(SRD_PDF_TEMPLATES).every(([id, t]) => t.id === id),
    'every template is registered under its own id',
  );
  assert(
    pdfTemplateFor('from-a-newer-build') === SRD_PDF_TEMPLATES.classic,
    'an unknown template draws as Classic',
  );
  assert(pdfTemplateFor(undefined) === SRD_PDF_TEMPLATES.classic, 'no template draws as Classic');
  const slots = SRD_PDF_TEMPLATES.classic.createSlots(config(), false)('body');
  const variants = [
    'type',
    'points',
    'sprint',
    'assignee',
    'status-todo',
    'status-in-progress',
    'status-done',
  ] as const;
  assert(
    variants.every((v) => slots.pill(v).backgroundColor),
    'every pill variant has colors',
  );
}

console.log('=== 5. Every template draws code without ligatures ===');
{
  // JetBrains Mono's ligatures (--, //, ::) crash react-pdf's font engine,
  // so any slot in any template that uses it must turn them off - which
  // pdfMonoStyle() does. Scans every slot, so new slots are covered too.
  const offenders: string[] = [];
  for (const [id, template] of Object.entries(SRD_PDF_TEMPLATES)) {
    const slots = template.createSlots(config(), true);
    for (const placement of ['body', 'sidebar'] as const) {
      const resolved = slots(placement);
      const styles: Array<[string, unknown]> = [
        ...Object.entries(resolved).filter(([key]) => key !== 'markdown' && key !== 'pill'),
        ...Object.entries(resolved.markdown).map(
          ([k, v]) => [`markdown.${k}`, v] as [string, unknown],
        ),
      ];
      for (const [name, style] of styles) {
        const s = style as { fontFamily?: string; fontFeatureSettings?: Record<string, boolean> };
        if (s?.fontFamily !== PDF_FONT_MONO) continue;
        if (s.fontFeatureSettings?.liga !== false || s.fontFeatureSettings?.calt !== false) {
          offenders.push(`${id}/${placement}/${name}`);
        }
      }
    }
  }
  assert(
    offenders.length === 0,
    `every monospace slot has ligatures off (${offenders.join(', ')})`,
  );
}

console.log('=== 6. Every sized style declares its line height ===');
{
  // react-pdf resolves a unitless line height against the declaring style's
  // own font size (18pt if it has none) and children inherit the points, so
  // a size without a line height - or the reverse - draws small text in a
  // tall line. Exempt: the page and the footer texts, where any line height
  // makes react-pdf drop the page numbers (nothing above them sets one).
  const offenders: string[] = [];
  for (const [id, template] of Object.entries(SRD_PDF_TEMPLATES)) {
    for (const fonts of [false, true]) {
      const resolved = template.createSlots(config(), fonts)('body');
      const pillVariants = [
        'type',
        'points',
        'sprint',
        'assignee',
        'status-todo',
        'status-in-progress',
        'status-done',
      ] as const;
      const styles: Array<[string, unknown]> = [
        ...Object.entries(resolved).filter(
          ([key]) => !['markdown', 'pill', 'page', 'footerLeft', 'footerRight'].includes(key),
        ),
        ...Object.entries(resolved.markdown).map(
          ([k, v]) => [`markdown.${k}`, v] as [string, unknown],
        ),
        ...pillVariants.map((v) => [`pill(${v})`, resolved.pill(v)] as [string, unknown]),
      ];
      for (const [name, style] of styles) {
        const st = style as { fontSize?: unknown; lineHeight?: unknown };
        if ((st.fontSize === undefined) !== (st.lineHeight === undefined))
          offenders.push(`${id}/${name}`);
      }
    }
  }
  assert(
    offenders.length === 0,
    `size and line height are declared together (${[...new Set(offenders)].join(', ')})`,
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
