/**
 * Duplicating scenarios and steps, saving and dropping diagram fragments,
 * and filtering and bulk-editing requirements - in a real browser.
 *
 * Run with: npx tsx scripts/verify-reuse-and-bulk-browser.ts
 * CHROMIUM_PATH may point at a Chromium build other than Playwright's own.
 */
import {type Browser, chromium, type Page} from 'playwright';
import {mkdtempSync, readFileSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';
import {type DevServers, startDevServers} from './lib/devServers';

// The shared fixture, plus a few more tickets to filter and bulk-edit.
const fixture = JSON.parse(readFileSync(resolve('fixtures/schema-0.8.json'), 'utf-8'));
// TICKET-1 starts Done - a status none of the bulk edits below sets - so
// "kept its own status" can only pass if the bulk edit left it alone.
const ticket1 = fixture.requirements.items.find((i: { id: string }) => i.id === 'TICKET-1');
ticket1.status = 'done';
fixture.requirements.items.push(
    {id: 'TICKET-2', typeId: 'type-ticket', title: 'Rate limits', body: '', status: 'todo'},
    {id: 'TICKET-3', typeId: 'type-ticket', title: 'Audit log', body: '', status: 'todo'},
    {id: 'TICKET-4', typeId: 'type-ticket', title: 'Token refresh', body: '', status: 'done'},
);
const FILE = join(mkdtempSync(join(tmpdir(), 'reuse-bulk-')), 'diagram.json');
writeFileSync(FILE, JSON.stringify(fixture));

let failures = 0;

function check(condition: boolean, message: string) {
    if (condition) console.log(`  ✓ ${message}`);
    else {
        failures++;
        console.error(`  FAIL: ${message}`);
    }
}

interface StoredNode {
    id: string;
    position: { x: number; y: number };
    data: Record<string, unknown> & { parentPath?: string[]; label?: string };
}

async function diagram(p: Page): Promise<{ nodes: StoredNode[]; edges: { id: string }[] }> {
    return p.evaluate(() =>
        (
            window as unknown as {
                __PERF__: { getDiagram: () => { nodes: unknown[]; edges: unknown[] } };
            }
        ).__PERF__.getDiagram(),
    ) as Promise<{ nodes: StoredNode[]; edges: { id: string }[] }>;
}

const rootNodes = async (p: Page) =>
    (await diagram(p)).nodes.filter((n) => (n.data.parentPath ?? []).length === 0);

async function select(p: Page, nodeIds: string[]) {
    await p.evaluate((ids) => {
        const perf = (
            window as unknown as {
                __PERF__: {
                    setSelectedNodes: (ids: string[]) => void;
                    setSelectedEdges: (ids: string[]) => void;
                };
            }
        ).__PERF__;
        perf.setSelectedNodes(ids);
        perf.setSelectedEdges([]);
    }, nodeIds);
    await p.waitForTimeout(150);
}

async function rightClickNode(p: Page, id: string) {
    await p.evaluate((nodeId) => {
        const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)!;
        const r = el.getBoundingClientRect();
        el.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                button: 2,
                clientX: r.x + 8,
                clientY: r.y + 8,
            }),
        );
    }, id);
    await p.waitForSelector('.canvas-context-menu');
}

/** Visible requirement cards, in order. */
async function cardIds(p: Page): Promise<string[]> {
    return p.$$eval('.requirements-view__content .requirement-card', (els) =>
        els.map((e) => (e as HTMLElement).dataset.requirementId ?? ''),
    );
}

async function run() {
    let servers: DevServers | undefined;
    let browser: Browser | undefined;
    try {
        servers = await startDevServers({vitePort: 5217, signalingPort: 14503, quiet: true});
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.CHROMIUM_PATH || undefined,
        });
        const p = await browser.newPage({viewport: {width: 1600, height: 1000}});
        p.on('pageerror', (e) => {
            failures++;
            console.error(`  FAIL: page threw: ${e.message}`);
        });

        await p.goto(servers.appUrl);
        await p.waitForSelector('.collab-panel__trigger');
        await p.setInputFiles('input[type="file"][accept="application/json"]', FILE);
        await p.waitForSelector('.react-flow__node[data-id="n-gateway"]');
        await p.waitForTimeout(500);

        console.log('=== Duplicate a scenario and a step ===');
        await p.click('button[title="Scenarios"]');
        await p.waitForSelector('.scenario-panel');
        await p.click('button[aria-label="Duplicate scenario"]');
        await p.waitForTimeout(150);
        const options = await p.$$eval('.scenario-panel__select option', (els) =>
            els.map((e) => e.textContent ?? ''),
        );
        check(options.length === 2, `there are two scenarios (${options.join(' | ')})`);
        check(
            (await p.inputValue('.scenario-panel__title-input')) === 'Login flow (copy)',
            'the copy is open, titled as a copy',
        );
        check(options[1]?.includes('3 steps') === true, 'the copy has every step of the original');
        await p
            .locator('.scenario-step-row')
            .first()
            .locator('button[aria-label="Duplicate step"]')
            .click();
        await p.waitForTimeout(150);
        const stepTitles = await p.$$eval('.scenario-step-row__title', (els) =>
            els.map((e) => e.textContent ?? ''),
        );
        check(
            stepTitles.length === 4 && stepTitles[1] === 'Request arrives (copy)',
            `the step copy lands right after its original (${stepTitles.join(' | ')})`,
        );
        check(
            (await p.$('.scenario-step-row.is-active .scenario-step-row__title'))
                ? (await p.textContent('.scenario-step-row.is-active .scenario-step-row__title')) ===
                'Request arrives (copy)'
                : false,
            'the step copy is the open step',
        );
        // Each row's controls are separate buttons, so the keyboard reaches
        // and activates them one by one.
        await p
            .locator('.scenario-step-row')
            .nth(3)
            .locator('button[aria-label="Duplicate step"]')
            .focus();
        await p.keyboard.press('Enter');
        await p.waitForTimeout(150);
        const afterKey = await p.$$eval('.scenario-step-row__title', (els) =>
            els.map((e) => e.textContent ?? ''),
        );
        check(
            afterKey.length === 5 && afterKey[4] === 'Check credentials (copy)',
            `Enter on a focused Duplicate step copies that step (${afterKey.join(' | ')})`,
        );
        check(
            ((await p.textContent('.scenario-panel__level')) ?? '').includes('Auth Service'),
            "the canvas goes to the duplicated step's diagram level",
        );
        await p.locator('.scenario-step-row').first().locator('.scenario-step-row__select').focus();
        await p.keyboard.press('Space');
        await p.waitForTimeout(150);
        check(
            (await p.textContent('.scenario-step-row.is-active .scenario-step-row__title')) ===
            'Request arrives',
            'Space on a focused step selects it',
        );
        check(
            ((await p.textContent('.scenario-panel__level')) ?? '').includes('Root'),
            'and goes back to its level',
        );
        await p.selectOption('.scenario-panel__select', {index: 0});
        await p.waitForTimeout(150);
        check((await p.$$('.scenario-step-row')).length === 3, 'the original scenario is unchanged');
        await p.click('button[aria-label="Close scenarios panel"]');

        console.log('=== Save a fragment ===');
        const before = await rootNodes(p);
        const labelOf = (id: string) => before.find((n) => n.id === id)?.data.label;
        await select(p, ['n-gateway', 'n-auth']);
        await rightClickNode(p, 'n-gateway');
        await p.hover('.canvas-context-menu button:has(span:text-is("Save as fragment"))');
        await p.waitForSelector('.save-fragment-panel');
        await p.fill('.save-fragment-panel__input', 'Gateway pair');
        await p.click('.save-fragment-panel__save');
        await p.waitForSelector('.app-toast');
        check(
            ((await p.textContent('.app-toast')) ?? '').includes('Gateway pair'),
            'a toast says where the fragment went',
        );
        check((await p.$('.canvas-context-menu')) === null, 'the menu closes');
        const stored = await p.evaluate(() =>
            JSON.parse(localStorage.getItem('system-design-editor:diagram-fragments') ?? '[]'),
        );
        check(stored.length === 1 && stored[0].name === 'Gateway pair', 'it is in the library');
        check(
            stored[0].contents.nodes.some((n: { relativePath: string[] }) => n.relativePath.length > 0),
            "it includes the auth service's sub-diagram",
        );

        console.log('=== Drop it from the palette ===');
        await p.click('.palette__mode-trigger');
        await p.click('.palette__mode-option:has-text("Fragments")');
        const item = p.locator('.palette__item--fragment', {hasText: 'Gateway pair'});
        check((await item.count()) === 1, 'the palette lists the fragment');
        await item.dragTo(p.locator('.react-flow__pane'), {targetPosition: {x: 900, y: 650}});
        await p.waitForTimeout(400);
        const after = await rootNodes(p);
        const added = after.filter((n) => !before.some((b) => b.id === n.id));
        check(added.length === 2, `two nodes were dropped in (${added.length})`);
        check(
            added.some((n) => n.data.label === labelOf('n-gateway')) &&
            added.some((n) => n.data.label === labelOf('n-auth')),
            'they are copies of the saved nodes',
        );
        const nested = (await diagram(p)).nodes.filter((n) =>
            added.some((a) => n.data.parentPath?.[0] === a.id),
        );
        check(nested.length > 0, 'the sub-diagram came along under the new copy');

        await p.reload();
        await p.waitForSelector('.palette__mode-trigger');
        await p.click('.palette__mode-trigger');
        await p.click('.palette__mode-option:has-text("Fragments")');
        check(
            (await p.locator('.palette__item--fragment', {hasText: 'Gateway pair'}).count()) === 1,
            'the fragment is still there after a reload',
        );

        console.log('=== Filter requirements ===');
        await p.setInputFiles('input[type="file"][accept="application/json"]', FILE);
        await p.waitForSelector('.react-flow__node[data-id="n-gateway"]');
        await p.click('button[title="Requirements"]');
        await p.waitForSelector('.requirements-view');
        check((await cardIds(p)).length === 5, 'all five items are listed');
        await p.click('.requirements-view__group-toggle button:has-text("Filter")');
        await p.waitForSelector('.requirements-filter-bar');
        await p.click('.filter-menu__trigger[aria-label^="Filter by status"]');
        await p.click('.filter-menu__option:has-text("To Do")');
        await p.waitForTimeout(150);
        check(
            (await cardIds(p)).join() === 'TICKET-2,TICKET-3',
            `status To Do leaves the two to-do tickets (${(await cardIds(p)).join()})`,
        );
        await p.keyboard.press('Escape');
        await p.click('.requirements-filter-bar__clear');
        await p.waitForTimeout(150);
        check((await cardIds(p)).length === 5, 'clearing the filter shows everything again');

        console.log('=== Bulk edit ===');
        await p.click('.requirements-view__group-toggle button:has-text("Select")');
        await p.waitForSelector('.bulk-edit-bar');
        await p.click('[data-requirement-id="TICKET-2"] .requirement-card__bulk-check');
        await p.click('[data-requirement-id="TICKET-4"] .requirement-card__bulk-check', {
            modifiers: ['Shift'],
        });
        await p.waitForTimeout(150);
        check(
            ((await p.textContent('.bulk-edit-bar__selection strong')) ?? '') === '3 selected',
            'shift-click selects the range',
        );
        await p.selectOption('select[aria-label="Set status of selected items"]', 'in-progress');
        await p.waitForTimeout(150);
        for (const id of ['TICKET-2', 'TICKET-3', 'TICKET-4']) {
            check(
                (await p.getAttribute(`[data-requirement-id="${id}"] .status-picker__trigger`, 'title')) ===
                'Status: In Progress',
                `${id} is now in progress`,
            );
        }
        check(
            (await p.getAttribute(
                '[data-requirement-id="TICKET-1"] .status-picker__trigger',
                'title',
            )) === 'Status: Done',
            'TICKET-1 kept its own status',
        );
        await p.selectOption('select[aria-label="Move selected items to a sprint"]', 'sp-2');
        await p.waitForTimeout(150);
        check(
            (
                (await p.textContent('[data-requirement-id="TICKET-3"] .sprint-picker__trigger')) ?? ''
            ).includes('Sprint 2'),
            'the selection moved to Sprint 2',
        );
        await p.fill('.bulk-edit-bar__tag-input', 'billing');
        await p.press('.bulk-edit-bar__tag-input', 'Enter');
        await p.waitForTimeout(150);
        check(
            (await p.locator('.requirement-tags__chip', {hasText: 'billing'}).count()) === 3,
            'the tag was added to all three',
        );

        await p.click('.filter-menu__trigger[aria-label^="Filter by tag"]').catch(async () => {
            await p.click('.requirements-view__group-toggle button:has-text("Filter")');
            await p.click('.filter-menu__trigger[aria-label^="Filter by tag"]');
        });
        await p.click('.filter-menu__option:has-text("billing")');
        await p.waitForTimeout(150);
        check(
            (await cardIds(p)).join() === 'TICKET-2,TICKET-3,TICKET-4',
            'filtering by the new tag finds exactly them',
        );
        await p.keyboard.press('Escape');
        check(
            ((await p.textContent('.bulk-edit-bar__selection strong')) ?? '') === '3 selected',
            'the selection survives filtering to the same items',
        );
        await p.click('button[aria-label="Stop selecting"]');
        check(
            (await p.$('.requirement-card__bulk-check')) === null,
            'leaving select mode hides the checkboxes',
        );
    } catch (err) {
        failures++;
        console.error('  FAIL: suite threw:', err);
    } finally {
        await browser?.close();
        await servers?.stop();
    }

    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
}

void run();
