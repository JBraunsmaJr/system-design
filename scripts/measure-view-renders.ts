/**
 * Render census for the non-canvas views (Requirements, Timeline).
 *
 * The perf harness (scripts/execute-perf-suite.ts) measures the diagram
 * canvas only. This measures the other views, so that refactoring them can
 * be shown to change nothing: for each interaction it records how many
 * commits happened and, BY COMPONENT NAME, how many times each component's
 * render function actually ran.
 *
 * How it counts, without touching application code:
 * - React calls `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` after every
 *   commit, in production builds too. The script installs a minimal hook
 *   before the app loads.
 * - For each commit it walks only the part of the fiber tree React actually
 *   visited (a subtree whose child pointer is shared with the previous tree
 *   was bailed out wholesale and is skipped), and counts every component
 *   fiber carrying React's PerformedWork flag - set exactly when the
 *   component's render function ran.
 * - The app is built for PRODUCTION (the dev build double-renders under
 *   StrictMode) but unminified, so component names are real.
 *
 * Usage:
 *   npx tsx scripts/measure-view-renders.ts [--repo <dir>] [--out <file>] [--repeats N]
 *   npx tsx scripts/measure-view-renders.ts --compare <before.json> <after.json>
 *
 * `--repo` builds another checkout (e.g. a worktree of main) so a branch can
 * be compared against its base with the same measuring code. A pure
 * refactor should produce an identical census; --compare exits non-zero if
 * any count differs.
 */
import { spawn, type ChildProcess } from 'child_process';
import { build, loadConfigFromFile, type PluginOption } from 'vite';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { chromium, type Page } from 'playwright';
import { waitForPort } from './lib/devServers';
import { toDiagramFile } from '../src/domain/canvas/serialization';
import type {
  RequirementItem,
  RequirementRelationship,
} from '../src/domain/requirements/requirementsTypes';
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from '../src/domain/requirements/requirementsRegistry';
import type { ProgramIncrement } from '../src/domain/timeline/programIncrements';
import type { Milestone } from '../src/domain/timeline/milestones';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (flag: string, fallback: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

export interface Census {
  commits: number;
  renders: number;
  byComponent: Record<string, number>;
  /** Normalised outerHTML of the scenario's `dom` root after it settled,
   * for scenarios that declare one (the modals, whose markup is the
   * product - the SRD preview is what becomes the PDF). */
  dom?: string;
  /** Every run's commit and render totals, in run order. Not compared -
   * kept so a scenario whose runs vary can be judged on its whole
   * distribution rather than on its median. */
  perRun?: { commits: number[]; renders: number[]; canvas: number[] };
}
type Results = Record<string, Census>;

const repoDir = resolve(arg('--repo', '.'));
const outFile = resolve(arg('--out', join(repoDir, 'dist', 'view-renders.json')));
const repeats = Math.max(1, Number(arg('--repeats', '3')));
const port = Number(arg('--port', '4191'));
/** Run only scenarios whose id starts with this prefix, e.g. `canvas/`. */
const only = arg('--only', '');

// ---------------------------------------------------------------------------
// A deterministic document large enough to be representative
// ---------------------------------------------------------------------------
function buildDocument() {
  const items: RequirementItem[] = [];
  const relationships: RequirementRelationship[] = [];
  const pis: ProgramIncrement[] = [];
  const sprintIds: string[] = [];
  for (let p = 1; p <= 3; p++) {
    const sprints = [1, 2, 3, 4].map((s) => {
      const id = `sp-${p}-${s}`;
      sprintIds.push(id);
      return { id, name: `Sprint ${p}.${s}`, durationDays: 14 };
    });
    pis.push({
      id: `pi-${p}`,
      name: `PI 2026.${p}`,
      startDate: `2026-0${p * 3 - 2}-05`,
      sprints,
      reservations: [],
    } as ProgramIncrement);
  }
  let rel = 0;
  for (let e = 1; e <= 8; e++) {
    items.push({
      id: `EPIC-${e}`,
      typeId: 'epic',
      title: `Epic ${e} ${e % 2 ? 'authentication' : 'reporting'} platform`,
      body: `Epic ${e} body text describing scope.`,
    });
    for (let t = 1; t <= 12; t++) {
      const n = (e - 1) * 12 + t;
      const id = `TICKET-${n}`;
      items.push({
        id,
        typeId: 'ticket',
        title: `Ticket ${n} ${n % 3 ? 'auth token' : 'report export'} work`,
        body: `Details for ticket ${n}.`,
        ...(n % 4 !== 0 ? { sprintId: sprintIds[n % sprintIds.length] } : {}),
        points: (n % 5) + 1,
      });
      relationships.push({
        id: `rel-${++rel}`,
        typeId: 'parent-of',
        fromItemId: `EPIC-${e}`,
        toItemId: id,
      });
      if (n % 7 === 0 && n > 1) {
        relationships.push({
          id: `rel-${++rel}`,
          typeId: 'blocks',
          fromItemId: `TICKET-${n - 1}`,
          toItemId: id,
        });
      }
    }
  }
  for (let r = 1; r <= 40; r++) {
    items.push({
      id: `REQ-${r}`,
      typeId: r % 5 === 0 ? 'risk' : 'requirement',
      title: `Requirement ${r} ${r % 2 ? 'authentication' : 'audit'} behavior`,
      body: `The system shall do thing ${r}.`,
    });
  }
  const milestones: Milestone[] = [
    { id: 'ms-1', type: 'release', name: 'Beta', scheduledAt: '2026-04-01' } as Milestone,
    { id: 'ms-2', type: 'release', name: 'GA', scheduledAt: '2026-08-01' } as Milestone,
  ];
  // Real diagram content (5 nodes, nested sub-diagrams, 2 edges) so the SRD
  // preview's component and connection tables are populated.
  const diagram = JSON.parse(
    readFileSync(
      join(fileURLToPath(new URL('.', import.meta.url)), '../fixtures/schema-0.7.json'),
      'utf8',
    ),
  );
  return toDiagramFile(
    'Render census fixture',
    diagram.nodes,
    diagram.edges,
    [],
    {
      itemTypes: BUILT_IN_ITEM_TYPES,
      relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
      categories: [],
      items,
      relationships,
    } as never,
    pis,
    {
      members: [],
      settings: { defaultPointsPerDay: 1, excludeUsHolidays: false, extraDaysOff: [] },
    } as never,
    milestones,
  );
}

// ---------------------------------------------------------------------------
// The in-page hook
// ---------------------------------------------------------------------------
/* Runs in the page before any application script. Kept free of closures over
 * Node-side values: Playwright serialises it. */
function installRenderHook() {
  // Fiber tags whose `type` is the user's component function or class.
  const COMPONENT_TAGS = new Set([0, 1, 11, 15]); // Function, Class, ForwardRef, SimpleMemo
  const PERFORMED_WORK = 1;
  const state = { commits: 0, lastCommitAt: 0, byComponent: {} as Record<string, number> };
  const ownName = (fiber: { tag: number; type: unknown }) => {
    const t = fiber.type as { displayName?: string; name?: string; render?: { name?: string } };
    const raw = (fiber.tag === 11 ? t?.render?.name : undefined) || t?.displayName || t?.name;
    // The bundler suffixes duplicate names ($1, $2) by module order, which a
    // file move can shift; the suffix is not part of the identity.
    return raw ? raw.replace(/\$\d+$/, '') : null;
  };
  type Fiber = {
    tag: number;
    type: unknown;
    flags: number;
    child: Fiber | null;
    sibling: Fiber | null;
    alternate: Fiber | null;
  };
  /** `owner` is the nearest named component above, so an anonymous component
   * is reported as Anonymous<Owner> rather than lumped with every other one. */
  const visit = (fiber: Fiber | null, owner: string) => {
    for (let f = fiber; f; f = f.sibling) {
      const isComponent = COMPONENT_TAGS.has(f.tag);
      const named = isComponent ? ownName(f) : null;
      if (isComponent && (f.flags & PERFORMED_WORK) !== 0) {
        const name = named ?? `Anonymous<${owner}>`;
        state.byComponent[name] = (state.byComponent[name] ?? 0) + 1;
      }
      // A child pointer shared with the previous tree means React bailed out
      // of this whole subtree: nothing below it ran, and its flags are stale.
      if (f.alternate === null || f.child !== f.alternate.child) visit(f.child, named ?? owner);
    }
  };
  let nextId = 1;
  const renderers = new Map<number, unknown>();
  (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers,
    inject(renderer: unknown) {
      const id = nextId++;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      state.commits++;
      state.lastCommitAt = performance.now();
      visit(root.current, 'Root');
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  (window as unknown as Record<string, unknown>).__RENDER_CENSUS__ = {
    reset() {
      state.commits = 0;
      state.byComponent = {};
    },
    msSinceLastCommit() {
      return performance.now() - state.lastCommitAt;
    },
    read() {
      const byComponent = { ...state.byComponent };
      const renders = Object.values(byComponent).reduce((a, b) => a + b, 0);
      return { commits: state.commits, renders, byComponent };
    },
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
/**
 * Waits until the app has been quiet - no commit at all - for QUIET_MS.
 *
 * A fixed delay is not enough: some interactions start timers that commit
 * later (RequirementsView clears a search-match highlight after 2 s; autosave
 * is debounced by 1 s). With a short fixed delay that commit lands in
 * whichever scenario's window it happens to reach, so two builds with the
 * same behavior report different per-scenario counts. Waiting for quiet
 * before AND after each action attributes every commit to the action that
 * caused it.
 */
const QUIET_MS = 2500;
const MAX_WAIT_MS = 15000;
async function settle(page: Page) {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    const quietFor = await page.evaluate(() =>
      (
        window as never as { __RENDER_CENSUS__: { msSinceLastCommit(): number } }
      ).__RENDER_CENSUS__.msSinceLastCommit(),
    );
    if (quietFor >= QUIET_MS) return;
    if (Date.now() > deadline) throw new Error(`App never went quiet for ${QUIET_MS}ms`);
    await page.waitForTimeout(Math.max(50, QUIET_MS - quietFor));
  }
}

async function measure(
  page: Page,
  action: () => Promise<void>,
  domSelector?: string,
): Promise<Census> {
  await settle(page);
  await page.evaluate(() =>
    (window as never as { __RENDER_CENSUS__: { reset(): void } }).__RENDER_CENSUS__.reset(),
  );
  await action();
  await settle(page);
  const census = await page.evaluate(() =>
    (window as never as { __RENDER_CENSUS__: { read(): Census } }).__RENDER_CENSUS__.read(),
  );
  if (domSelector) {
    census.dom = await page.evaluate((sel) => {
      // Every match, in document order: the canvas menu and its submenu are
      // sibling portals. A single-element selector gives the same output as
      // before.
      const els = [...document.querySelectorAll(sel)];
      if (els.length === 0) return `<missing ${sel}>`;
      return (
        els
          .map((el) => el.outerHTML)
          .join('\n')
          // Captured diagram images are pixels, not markup.
          .replace(/(src|href)="(data|blob):[^"]*"/g, '$1="$2:..."')
          .replace(/url\((&quot;|")?data:[^)]*\)/g, 'url(data:...)')
          // Library ids embed Date.now().
          .replace(/custom-lib-\d+/g, 'custom-lib-N')
      );
    }, domSelector);
  }
  return census;
}

async function typeSlowly(page: Page, selector: string, text: string) {
  const input = page.locator(selector).first();
  await input.click();
  for (const ch of text) {
    await input.press(ch === ' ' ? 'Space' : ch);
    await page.waitForTimeout(60);
  }
}

const SRD = '.srd-view';
const LIB = '.modal-overlay';
const MENU = '.canvas-context-menu, .color-picker-panel, .icon-picker__panel';
const menuItem = (label: string) => `.canvas-context-menu button:has-text("${label}")`;
/*
 * Right-clicking a node hovers it first, which opens its documentation
 * popup, and the popup can sit over the menu. A real mouse hover then lands
 * on the popup, so the menu is driven with dispatched events instead: React
 * derives onMouseEnter from `mouseover`, and a dispatched `click` bubbles to
 * the document listener that dismisses the menu exactly like a real one.
 */
const enterMenuItem = (p: Page, label: string) => p.dispatchEvent(menuItem(label), 'mouseover');
const pointerToEmptyCanvas = async (p: Page) => {
  const pane = await p.locator('.react-flow__pane').boundingBox();
  if (!pane) throw new Error('no canvas pane');
  await p.mouse.move(pane.x + pane.width - 40, pane.y + 40);
};
const gatewayCentre = async (p: Page) => {
  const box = await p.locator('.react-flow__node:has-text("API Gateway")').boundingBox();
  if (!box) throw new Error('API Gateway node not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
/*
 * Hovering and right-clicking are separate steps. Done together, the hover's
 * mousemove (a low-priority update for the documentation popup) and the
 * contextmenu event (flushed immediately) raced: depending on scheduling
 * they committed together or apart, so the same build reported 3 or 5
 * commits. The hover is a setup step that settles first; the measured step
 * right-clicks at the same point, so no mousemove is involved.
 */
const hoverGateway = async (p: Page) => {
  const c = await gatewayCentre(p);
  await p.mouse.move(c.x, c.y);
};
const rightClickGateway = async (p: Page) => {
  const c = await gatewayCentre(p);
  await p.mouse.click(c.x, c.y, { button: 'right' });
};
/** The SRD sidebar's tabs, in order: Doc, Layout, Snapshots, Theme, Headers. */
const srdTab = (p: Page, index: number) =>
  p.click(`.srd-sidebar button.srd-btn-icon >> nth=${index}`);
const srdField = (label: string) =>
  `.srd-sidebar__field:has(label:text-is("${label}")) input >> nth=0`;

type Scenario = {
  id: string;
  run: (page: Page) => Promise<void>;
  dom?: string;
  /** Preparation between measured steps, not itself a measurement:
   * recorded but never compared. Most only put the app into a known state
   * (pointer on empty canvas, hovering a node); two are timing-dependent
   * even on main (srd/to-diagram, canvas/menu-reopen - see each). The
   * steps after every one of them are stable. */
  setup?: true;
};

const SCENARIOS: Scenario[] = [
  // --- Requirements view -------------------------------------------------
  { id: 'req/open', run: (p) => p.click('button[title="Requirements"]') },
  { id: 'req/type-search', run: (p) => typeSlowly(p, '.requirements-view__search-input', 'auth') },
  { id: 'req/next-match', run: (p) => p.click('button[aria-label="Next match"]') },
  {
    id: 'req/clear-search',
    run: (p) => p.locator('button[aria-label="Clear search"]').first().click(),
  },
  { id: 'req/collapse-all', run: (p) => p.click('button[aria-label="Collapse all cards"]') },
  { id: 'req/expand-all', run: (p) => p.click('button[aria-label="Expand all cards"]') },
  // --- Timeline view -----------------------------------------------------
  { id: 'timeline/open', run: (p) => p.click('button[title="Timeline"]') },
  {
    id: 'timeline/gantt',
    run: (p) => p.click('.timeline-view__mode-toggle button:has-text("Gantt")'),
  },
  {
    id: 'timeline/board',
    run: (p) => p.click('.timeline-view__mode-toggle button:has-text("Board")'),
  },
  {
    id: 'timeline/filter-epic',
    run: (p) => p.selectOption('.timeline-view__epic-select', 'EPIC-3').then(() => undefined),
  },
  {
    id: 'timeline/filter-all',
    run: (p) => p.selectOption('.timeline-view__epic-select', 'all').then(() => undefined),
  },
  {
    id: 'timeline/type-backlog',
    run: (p) => typeSlowly(p, 'input[placeholder="Search backlog..."]', 'report'),
  },
  { id: 'timeline/open-item', run: (p) => p.getByText('Ticket 5 auth token work').first().click() },
  { id: 'timeline/close-item', run: (p) => p.keyboard.press('Escape') },
  // --- SRD view (DOM compared: the preview is what becomes the PDF) -----
  // Remounting the canvas lets React Flow measure its nodes through
  // ResizeObserver, so this step's commit count varies from run to run.
  { id: 'srd/to-diagram', setup: true, run: (p) => p.click('button[title="Diagram"]') },
  {
    id: 'srd/open',
    dom: SRD,
    run: async (p) => {
      await p.click('button[title^="Solution Requirement Document"]');
      await p.waitForSelector(SRD);
    },
  },
  { id: 'srd/type-title', dom: SRD, run: (p) => typeSlowly(p, srdField('Document Title'), ' v2') },
  { id: 'srd/tab-layout', dom: SRD, run: (p) => srdTab(p, 1) },
  { id: 'srd/component-table', dom: SRD, run: (p) => p.check('#includeComponentTableCheckbox') },
  {
    id: 'srd/connections-table',
    dom: SRD,
    run: (p) => p.check('#includeConnectionsTableCheckbox'),
  },
  { id: 'srd/tab-snapshots', dom: SRD, run: (p) => srdTab(p, 2) },
  { id: 'srd/tab-theme', dom: SRD, run: (p) => srdTab(p, 3) },
  {
    id: 'srd/theme-color',
    dom: SRD,
    run: (p) => p.fill('.srd-sidebar__color-picker-row input[type="text"] >> nth=0', '#10b981'),
  },
  { id: 'srd/tab-headers', dom: SRD, run: (p) => srdTab(p, 4) },
  { id: 'srd/header-left', dom: SRD, run: (p) => typeSlowly(p, srdField('Header Left'), 'DRAFT') },
  {
    id: 'srd/preset',
    dom: SRD,
    run: (p) =>
      p.selectOption('.srd-sidebar__select >> nth=0', 'agile_engineering').then(() => undefined),
  },
  { id: 'srd/tab-doc', dom: SRD, run: (p) => srdTab(p, 0) },
  { id: 'srd/close', run: (p) => p.click('button[title="Diagram"]') },
  // --- Library manager modal ---------------------------------------------
  {
    id: 'lib/open',
    dom: LIB,
    run: (p) => p.click('button[title="Manage Shape & Icon Libraries"]'),
  },
  { id: 'lib/new-library', dom: LIB, run: (p) => p.click(`${LIB} button:has-text("New Library")`) },
  {
    id: 'lib/type-name',
    dom: LIB,
    run: (p) => typeSlowly(p, 'input[placeholder="e.g. Company Architecture"]', 'Census'),
  },
  { id: 'lib/create', dom: LIB, run: (p) => p.click(`${LIB} button:has-text("Create Library")`) },
  { id: 'lib/add-icon', dom: LIB, run: (p) => p.click(`${LIB} button:has-text("Add Icon")`) },
  {
    id: 'lib/type-icon',
    dom: LIB,
    run: (p) => typeSlowly(p, 'input[placeholder="e.g. Auth Gateway"]', 'Gate'),
  },
  { id: 'lib/save-icon', dom: LIB, run: (p) => p.click(`${LIB} button:has-text("Save Icon")`) },
  { id: 'lib/add-shape', dom: LIB, run: (p) => p.click(`${LIB} button:has-text("Add Shape")`) },
  {
    id: 'lib/type-shape',
    dom: LIB,
    run: (p) => typeSlowly(p, 'input[placeholder="e.g. Edge Node"]', 'Edge'),
  },
  { id: 'lib/save-shape', dom: LIB, run: (p) => p.click(`${LIB} button:has-text("Save Shape")`) },
  { id: 'lib/close', run: (p) => p.keyboard.press('Escape') },
  // --- Canvas right-click menu (DOM compared) ----------------------------
  // Each right-click starts from the same state: pointer on empty canvas,
  // documentation popup closed. Otherwise whether the popup is open when
  // the menu opens depends on the previous step's hover timers.
  { id: 'canvas/pointer-away', setup: true, run: pointerToEmptyCanvas },
  { id: 'canvas/hover-gateway', setup: true, run: hoverGateway },
  { id: 'canvas/menu-open', dom: MENU, run: rightClickGateway },
  { id: 'canvas/color-submenu', dom: MENU, run: (p) => enterMenuItem(p, 'Change color') },
  { id: 'canvas/icon-submenu', dom: MENU, run: (p) => enterMenuItem(p, 'Change icon') },
  { id: 'canvas/back-to-color', dom: MENU, run: (p) => enterMenuItem(p, 'Change color') },
  {
    id: 'canvas/apply-color',
    dom: MENU,
    run: (p) => p.dispatchEvent('.color-picker-panel__grid button >> nth=2', 'click'),
  },
  { id: 'canvas/pointer-away-again', setup: true, run: pointerToEmptyCanvas },
  { id: 'canvas/hover-gateway-again', setup: true, run: hoverGateway },
  // Reopening only sets up menu-escape. It is not compared: even with the
  // hover settled first, leftover documentation-popup timers from the
  // steps before make its commit count vary on main (1 or 3 across 9
  // runs). Opening the menu is measured, deterministically, by menu-open.
  { id: 'canvas/menu-reopen', setup: true, run: rightClickGateway },
  { id: 'canvas/menu-escape', dom: MENU, run: (p) => p.keyboard.press('Escape') },
];

async function runOnce(appUrl: string, docJson: string): Promise<Results> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    // tsx compiles this script with esbuild's keepNames, which wraps
    // functions in a `__name(...)` helper that does not exist in the page
    // once Playwright serialises installRenderHook. Identity shim first.
    await context.addInitScript({ content: 'window.__name = (f) => f;' });
    await context.addInitScript(installRenderHook);
    const page = await context.newPage();
    page.on('dialog', (d) => void d.dismiss());
    page.on('pageerror', (e) => console.error('  page error:', e.message));
    await page.goto(appUrl);
    await page.waitForSelector('button[title="Requirements"]');
    await page.setInputFiles('input[type="file"][accept="application/json"]', {
      name: 'fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(docJson),
    });
    await settle(page);
    const results: Results = {};
    for (const s of SCENARIOS) {
      if (only && !s.id.startsWith(only)) continue;
      results[s.id] = await measure(page, () => s.run(page), s.dom);
    }
    return results;
  } finally {
    await browser.close();
  }
}

/**
 * The repo's own Vite config, built for production with two changes: no
 * minification, so component names survive, and no PWA plugin. The
 * unminified bundle is over the service worker's precache limit, and a
 * service worker has no business caching the page being measured anyway.
 */
async function buildForCensus(root: string, outDir: string) {
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    join(root, 'vite.config.ts'),
    root,
  );
  if (!loaded) throw new Error(`No vite.config.ts in ${root}`);
  const isPwa = (p: PluginOption): boolean =>
    Array.isArray(p)
      ? p.some(isPwa)
      : !!p && typeof p === 'object' && 'name' in p && String(p.name).startsWith('vite-plugin-pwa');
  await build({
    ...loaded.config,
    configFile: false,
    root,
    base: './',
    logLevel: 'error',
    plugins: (loaded.config.plugins ?? []).filter((p) => !isPwa(p)),
    build: { ...loaded.config.build, minify: false, outDir, emptyOutDir: true },
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const outDir = mkdtempSync(join(tmpdir(), 'view-renders-'));
  console.log(`Building ${repoDir} (production, unminified) ...`);
  await buildForCensus(repoDir, outDir);

  let server: ChildProcess | null = null;
  try {
    server = spawn(
      process.execPath,
      [
        join(repoDir, 'node_modules/vite/bin/vite.js'),
        'preview',
        '--outDir',
        outDir,
        '--port',
        String(port),
        '--strictPort',
        '--host',
        '127.0.0.1',
      ],
      { cwd: repoDir, detached: process.platform !== 'win32', stdio: 'ignore' },
    );
    await waitForPort(port);
    const appUrl = `http://127.0.0.1:${port}/`;
    const docJson = JSON.stringify(buildDocument());

    const runs: Results[] = [];
    for (let i = 0; i < repeats; i++) {
      process.stdout.write(`Run ${i + 1}/${repeats} ... `);
      runs.push(await runOnce(appUrl, docJson));
      console.log('done');
    }
    // Median per counter, per scenario; flag any scenario whose runs disagree.
    const results: Results = {};
    for (const s of SCENARIOS) {
      if (only && !s.id.startsWith(only)) continue;
      const names = new Set(runs.flatMap((r) => Object.keys(r[s.id].byComponent)));
      const byComponent: Record<string, number> = {};
      for (const n of [...names].sort()) {
        byComponent[n] = median(runs.map((r) => r[s.id].byComponent[n] ?? 0));
        if (byComponent[n] === 0) delete byComponent[n];
      }
      results[s.id] = {
        commits: median(runs.map((r) => r[s.id].commits)),
        renders: median(runs.map((r) => r[s.id].renders)),
        byComponent,
        ...(runs[0][s.id].dom !== undefined ? { dom: runs[0][s.id].dom } : {}),
        perRun: {
          commits: runs.map((r) => r[s.id].commits),
          renders: runs.map((r) => r[s.id].renders),
          canvas: runs.map((r) => r[s.id].byComponent.Canvas ?? 0),
        },
      };
      const varied = new Set(runs.map((r) => JSON.stringify(r[s.id]))).size > 1;
      console.log(
        `  ${s.id.padEnd(24)} commits=${String(results[s.id].commits).padStart(3)}  renders=${String(results[s.id].renders).padStart(5)}${varied ? '  (runs varied)' : ''}`,
      );
    }
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`\nSaved ${outFile}`);
  } finally {
    if (server?.pid) {
      try {
        process.kill(-server.pid);
      } catch {
        server.kill();
      }
    }
  }
}

function compare(beforePath: string, afterPath: string): number {
  const before: Results = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after: Results = JSON.parse(readFileSync(afterPath, 'utf8'));
  let differences = 0;
  const setupIds = new Set(SCENARIOS.filter((s) => s.setup).map((s) => s.id));
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[id];
    const b = after[id];
    if (setupIds.has(id)) {
      console.log(`${id.padEnd(24)} setup step, not compared`);
      continue;
    }
    if (!a || !b) {
      console.log(`${id}: only in ${a ? 'before' : 'after'}`);
      differences++;
      continue;
    }
    const lines: string[] = [];
    if (a.commits !== b.commits) lines.push(`commits ${a.commits} -> ${b.commits}`);
    for (const n of new Set([...Object.keys(a.byComponent), ...Object.keys(b.byComponent)])) {
      const x = a.byComponent[n] ?? 0;
      const y = b.byComponent[n] ?? 0;
      if (x !== y) lines.push(`${n} ${x} -> ${y}`);
    }
    if (a.dom !== b.dom) {
      const x = a.dom ?? '';
      const y = b.dom ?? '';
      let i = 0;
      while (i < x.length && i < y.length && x[i] === y[i]) i++;
      lines.push(
        `DOM differs at char ${i}: before "...${x.slice(Math.max(0, i - 60), i + 60)}..." after "...${y.slice(Math.max(0, i - 60), i + 60)}..."`,
      );
    }
    const domNote = b.dom !== undefined ? `, DOM identical (${b.dom.length} chars)` : '';
    console.log(
      `${id.padEnd(24)} ${lines.length ? 'DIFFERS: ' + lines.join(', ') : `identical (${b.commits} commits, ${b.renders} renders${domNote})`}`,
    );
    differences += lines.length;
  }
  console.log(differences ? `\n${differences} difference(s)` : '\nIdentical render census.');
  return differences ? 1 : 0;
}

// Dispatched here, after every declaration: compare() reads SCENARIOS.
if (argv[0] === '--compare') {
  process.exit(compare(argv[1], argv[2]));
} else {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
