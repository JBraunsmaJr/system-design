/**
 * The shared section renderers through the Classic template: content parity
 * with the HTML preview, pagination of long content, empty states, settings,
 * and the template registry.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/pdf/sections/SrdPdfSections.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { SrdPdfDocument } from '../SrdPdfDocument';
import { SrdDocumentPreview } from '../../SrdDocumentPreview';
import { SRD_PDF_TEMPLATES, pdfTemplateFor } from '../templates';
import { PDF_FONT_MONO } from '../srdPdfFonts';
import { DEFAULT_SRD_TEMPLATE } from '../../../../domain/srd/srdTemplatePresets';
import type {
  RequirementItemViewModel,
  SrdDataContext,
  SrdTemplateConfig,
} from '../../../../domain/srd/srdTypes';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const squash = (text: string) => text.replace(/\s+/g, '');
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';

// react-pdf reports an unwrappable element taller than a page with a
// warning, then draws it cut off; any such warning fails the run.
const oversized: string[] = [];
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes("can't wrap between pages")) oversized.push(String(args[0]));
  else warn(...args);
};

function item(
  n: number,
  overrides: Partial<RequirementItemViewModel> = {},
): RequirementItemViewModel {
  return {
    id: `REQ-${n}`,
    typeId: 'req',
    typeLabel: 'Requirement',
    // Unique markers: no title is a prefix of another or used elsewhere.
    title: `Requirement title ${n} end`,
    body: `Body of requirement ${n} with **bold** text.`,
    status: (['todo', 'in-progress', 'done'] as const)[n % 3],
    points: n,
    sprintName: `SPRINT-${n}-end`,
    assigneeName: `Owner ${n}`,
    linkedNodeIds: [`node-${n}`],
    linkedNodeLabels: [`Service ${n}`],
    contextSnapshotBase64: PNG,
    ...overrides,
  };
}

function richData(counts = { components: 6, items: 8 }): SrdDataContext {
  const items = Array.from({ length: counts.items }, (_, i) => item(i + 1));
  return {
    metadata: {
      title: 'Payments Platform',
      description: 'Handles **card payments** and refunds.\n\n- Fraud checks\n- Settlement',
      generatedAt: '2026-10-01',
      version: '4.2.0',
      authors: [{ name: 'Dana Lee', role: 'Architect' }],
      organization: 'Acme Corp',
    },
    branding: {
      primaryColor: '#1e3a8a',
      secondaryColor: '#475569',
      accentColor: '#0ea5e9',
      fontFamily: 'Inter',
    },
    headersAndFooters: {},
    architecture: {
      diagramImageBase64: PNG,
      components: Array.from({ length: counts.components }, (_, i) => ({
        id: `c${i}`,
        name: `Component ${i}`,
        type: i % 2 ? 'service' : 'database',
        description: `Responsibility of component ${i}`,
        linkedRequirementIds: [`REQ-${i + 1}`],
      })),
      connections: [
        {
          from: 'c0',
          fromName: 'Component 0',
          to: 'c1',
          toName: 'Component 1',
          label: 'Reads ledger',
          protocol: 'gRPC',
        },
        { from: 'c1', to: 'c2', label: 'Publishes events', edgeType: 'async' },
      ],
    },
    requirements: {
      categories: [
        { id: 'sec', label: 'Security', color: '#10b981' },
        { id: 'perf', label: 'Performance', color: '#f59e0b' },
        { id: 'empty', label: 'Unused', color: '#000000' },
      ],
      itemsByCategory: {
        sec: items.slice(0, Math.ceil(items.length / 2)),
        perf: items.slice(Math.ceil(items.length / 2)),
      },
      summaryStats: {
        total: items.length,
        completed: 2,
        inProgress: 3,
        totalPoints: 36,
        completedPoints: 9,
      },
    },
    traceability: [
      {
        sourceId: 'REQ-1',
        sourceTitle: 'Login flow',
        relation: 'depends-on',
        targetId: 'REQ-2',
        targetTitle: 'Session store',
      },
    ],
    roadmap: {
      milestones: [
        {
          id: 'm1',
          title: 'Beta Launch',
          targetDate: '2026-12-01',
          status: 'planned',
          type: 'release',
          description: 'First customers',
        },
      ],
      sprints: [
        {
          id: 's1',
          piName: 'PI-7',
          name: 'Sprint 1',
          startDate: '2026-10-05',
          endDate: '2026-10-18',
          totalPoints: 21,
          assignedItems: ['REQ-1', 'REQ-2'],
        },
      ],
      epicSchedules: [],
    },
  };
}

function config(overrides: Partial<SrdTemplateConfig> = {}): SrdTemplateConfig {
  const base = structuredClone(DEFAULT_SRD_TEMPLATE);
  return {
    ...base,
    includeComponentTable: true,
    includeConnectionsTable: true,
    sections: base.sections.map((s) => ({ ...s, enabled: true })),
    ...overrides,
  };
}

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

/** The words the HTML preview shows for a document. */
function previewWords(data: SrdDataContext, cfg: SrdTemplateConfig): string[] {
  const sections = cfg.sections.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const html = renderToStaticMarkup(
    <SrdDocumentPreview
      templateConfig={cfg}
      currentSrdData={data}
      paperRef={{ current: null }}
      activeSortedSections={sections}
    />,
  );
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
  return [...new Set(text.split(/\s+/).filter((w) => w.length > 0))];
}

console.log('=== 1. Content parity with the HTML preview ===');
for (const layout of ['list', 'table'] as const) {
  const cfg = config({ requirementsLayout: layout });
  const data = richData();
  const pdfText = squash((await pdfPages(data, cfg)).join(' ')).toUpperCase();
  // The preview's running footer shows page 1 of 1; page numbers are the
  // PDF's own, so they are not content to compare.
  const missing = previewWords(data, cfg).filter(
    (w) => !pdfText.includes(squash(w).toUpperCase()) && !/^\d+$/.test(w),
  );
  assert(
    missing.length === 0,
    `${layout} layout: every word the preview shows is in the PDF${missing.length ? ` (missing: ${missing.slice(0, 12).join(' ')})` : ''}`,
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

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
