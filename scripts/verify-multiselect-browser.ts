/**
 * Multi-selection editing in a real browser: the Inspector editing many
 * items at once, the edge panel's thickness and routing, and the context
 * menu's duplicate / group / ungroup / lock / style / requirement commands.
 *
 * Each check reads back what was WRITTEN to the document (window.__PERF__
 * .getDiagram), not only what the canvas drew, and the batch edits are
 * checked to be a single undo step.
 *
 * Run with: npx tsx scripts/verify-multiselect-browser.ts
 * CHROMIUM_PATH may point at a Chromium build other than Playwright's own.
 */
import {type Browser, chromium, type Page} from 'playwright';
import {mkdtempSync, readFileSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';
import {type DevServers, startDevServers} from './lib/devServers';

const FILE = join(mkdtempSync(join(tmpdir(), 'multiselect-')), 'diagram.json');
writeFileSync(FILE, readFileSync(resolve('fixtures/schema-0.8.json')));

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
    type?: string;
    parentId?: string;
    data: Record<string, unknown> & { parentPath?: string[] };
}

interface StoredEdge {
    id: string;
    data?: Record<string, unknown>;
}

async function diagram(p: Page): Promise<{ nodes: StoredNode[]; edges: StoredEdge[] }> {
    return p.evaluate(() =>
        (
            window as unknown as {
                __PERF__: { getDiagram: () => { nodes: unknown[]; edges: unknown[] } };
            }
        ).__PERF__.getDiagram(),
    ) as Promise<{ nodes: StoredNode[]; edges: StoredEdge[] }>;
}

const rootNodes = async (p: Page) =>
    (await diagram(p)).nodes.filter((n) => (n.data.parentPath ?? []).length === 0);
const nodeById = async (p: Page, id: string) => (await diagram(p)).nodes.find((n) => n.id === id);
const edgeById = async (p: Page, id: string) => (await diagram(p)).edges.find((e) => e.id === id);

async function select(p: Page, nodeIds: string[], edgeIds: string[] = []) {
    await p.evaluate(
        ([n, e]) => {
            const perf = (
                window as unknown as {
                    __PERF__: {
                        setSelectedNodes: (ids: string[]) => void;
                        setSelectedEdges: (ids: string[]) => void;
                    };
                }
            ).__PERF__;
            perf.setSelectedNodes(n);
            perf.setSelectedEdges(e);
        },
        [nodeIds, edgeIds] as const,
    );
    await p.waitForTimeout(150);
}

/** Dispatched rather than clicked: a boundary's interior is click-through,
 * and the fixture's nodes overlap, so a real click can land on a neighbor. */
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

/** Right-clicks the middle of an edge's drawn line. */
async function rightClickEdge(p: Page, id: string) {
    const point = await p.evaluate((edgeId) => {
        const path = document.querySelector<SVGPathElement>(
            `.react-flow__edge[data-id="${edgeId}"] path.typed-edge`,
        )!;
        const at = path.getPointAtLength(path.getTotalLength() / 2);
        const m = path.getScreenCTM()!;
        return {x: m.a * at.x + m.c * at.y + m.e, y: m.b * at.x + m.d * at.y + m.f};
    }, id);
    await p.mouse.click(point.x, point.y, {button: 'right'});
    await p.waitForSelector('.canvas-context-menu');
}

async function menuItems(p: Page): Promise<string[]> {
    return p.$$eval('.canvas-context-menu button span', (els) =>
        els.map((e) => e.textContent?.trim() ?? ''),
    );
}

async function clickMenu(p: Page, label: string) {
    await p.click(`.canvas-context-menu button:has(span:text-is("${label}"))`);
    await p.waitForTimeout(150);
}

async function run() {
    let servers: DevServers | undefined;
    let browser: Browser | undefined;
    try {
        servers = await startDevServers({vitePort: 5211, signalingPort: 14497, quiet: true});
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

        console.log('=== Inspector: many nodes and an edge at once ===');
        const trio = ['n-gateway', 'n-auth', 'n-db'];
        await select(p, trio, ['e1']);
        check(
            (await p.textContent('.inspector .panel-header')) === '4 selected',
            'the Inspector edits the whole selection, not just the first item',
        );
        const nodesSection = p.locator('.inspector__section').nth(0);
        const edgesSection = p.locator('.inspector__section').nth(1);
        await nodesSection.locator('input[type="color"]').fill('#ff0000');
        await p.waitForTimeout(150);
        for (const id of trio)
            check((await nodeById(p, id))?.data.color === '#ff0000', `${id} got the new color`);
        check(
            (await nodeById(p, 'n-note'))?.data.color === undefined,
            'a node outside the selection is untouched',
        );

        await nodesSection.locator('.tag-editor__input').fill('env:prod');
        await nodesSection.locator('.tag-editor__input').press('Enter');
        await p.waitForTimeout(150);
        for (const id of trio)
            check(
                ((await nodeById(p, id))?.data.tags as string[]).includes('env:prod'),
                `${id} got the tag`,
            );

        console.log('=== Inspector: edge thickness and routing ===');
        await edgesSection.locator('select').nth(1).selectOption('5');
        await edgesSection.locator('button[role="radio"]:has-text("Curved")').click();
        await p.waitForTimeout(150);
        const e1 = await edgeById(p, 'e1');
        check(e1?.data?.strokeWidth === 5, 'thickness is written to the edge');
        check(e1?.data?.routing === 'curved', 'routing is written to the edge');
        const drawn = await p.$eval('.react-flow__edge[data-id="e1"] path.typed-edge', (el) => ({
            d: el.getAttribute('d') ?? '',
            width: (el as SVGPathElement).style.strokeWidth,
        }));
        check(drawn.d.includes('C'), `the edge is drawn as a curve (${drawn.d.slice(0, 40)}...)`);
        check(
            drawn.width === '5.75',
            `the edge is drawn at its thickness (+selection: ${drawn.width})`,
        );

        await edgesSection.locator('input[type="color"]').fill('#00aa00');
        await p.waitForTimeout(150);
        const arrow = await p.$eval(
            '.react-flow__edge[data-id="e1"] marker polyline',
            (el) => (el as SVGElement).style.stroke,
        );
        check(
            arrow === 'rgb(0, 170, 0)' || arrow === '#00aa00',
            `the arrowhead follows the line color (${arrow})`,
        );

        console.log('=== Lock, and undo ===');
        // Past the undo manager's capture window, so the undo below takes back
        // the lock alone rather than everything edited a moment before it.
        await p.waitForTimeout(700);
        await nodesSection.locator('.inspector__checkbox:has-text("Locked") input').check();
        await p.waitForTimeout(150);
        for (const id of trio) check((await nodeById(p, id))?.data.locked === true, `${id} is locked`);
        check(
            (await p.locator('.react-flow__node.is-locked').count()) === 3,
            'locked nodes show the lock badge',
        );
        await p.click('.react-flow__pane', {position: {x: 5, y: 5}});
        await p.keyboard.press('Control+z');
        await p.waitForTimeout(200);
        const lockedAfterUndo = (
            await Promise.all(trio.map(async (id) => (await nodeById(p, id))?.data.locked))
        ).filter(Boolean).length;
        check(lockedAfterUndo === 0, 'one undo unlocks all of them');
        check(
            (await nodeById(p, 'n-gateway'))?.data.color === '#ff0000',
            'and leaves the earlier color change alone',
        );

        console.log('=== Locked nodes stay put ===');
        await select(p, ['n-db']);
        await p.locator('.inspector .inspector__checkbox:has-text("Locked") input').check();
        await p.waitForTimeout(150);
        check(
            await p.locator('.inspector__delete').isDisabled(),
            "a locked node's delete button is disabled",
        );
        await p.keyboard.press('Delete');
        await p.waitForTimeout(150);
        check((await nodeById(p, 'n-db')) !== undefined, 'the Delete key skips a locked node');
        const before = (await nodeById(p, 'n-db'))!;
        const box = (await p.locator('.react-flow__node[data-id="n-db"]').boundingBox())!;
        await p.mouse.move(box.x + 10, box.y + 10);
        await p.mouse.down();
        await p.mouse.move(box.x + 160, box.y + 120, {steps: 8});
        await p.mouse.up();
        await p.waitForTimeout(200);
        const after = (await diagram(p)).nodes.find((n) => n.id === 'n-db') as unknown as {
            position: { x: number; y: number };
        };
        check(
            JSON.stringify(after.position) ===
            JSON.stringify((before as unknown as { position: unknown }).position),
            'dragging a locked node does not move it',
        );

        console.log('=== Context menu on nodes ===');
        await select(p, ['n-gateway', 'n-auth']);
        await rightClickNode(p, 'n-gateway');
        const items = await menuItems(p);
        for (const label of [
            'Duplicate',
            'Group',
            'Lock',
            'Copy style',
            'Paste style',
            'Link requirement',
        ])
            check(items.includes(label), `offers "${label}"`);
        check(
            await p.locator('.canvas-context-menu button:has(span:text-is("Paste style"))').isDisabled(),
            'paste style is disabled until a style has been copied',
        );

        const countBefore = (await rootNodes(p)).length;
        await clickMenu(p, 'Duplicate');
        check((await rootNodes(p)).length === countBefore + 2, 'duplicate copies both nodes');
        const copies = (await rootNodes(p)).filter(
            (n) => !['n-gateway', 'n-auth', 'n-db', 'n-note', 'n-boundary'].includes(n.id),
        );
        check(
            copies.length === 2 && copies.some((n) => n.data.label === 'API Gateway'),
            "the copies carry the originals' data",
        );

        await select(p, ['n-gateway', 'n-auth']);
        await rightClickNode(p, 'n-gateway');
        await clickMenu(p, 'Group');
        let nodes = await rootNodes(p);
        const group = nodes.find((n) => n.type === 'group' && n.data.nodeType === 'group');
        check(group !== undefined, 'group creates a plain boundary');
        check(
            nodes.filter((n) => n.parentId === group?.id).length === 2,
            'both nodes now sit inside it',
        );
        check(
            (await p.textContent('.inspector .panel-header'))?.trim() === 'Group',
            'the new boundary is selected',
        );

        await rightClickNode(p, group!.id);
        await clickMenu(p, 'Ungroup');
        nodes = await rootNodes(p);
        check(!nodes.some((n) => n.id === group!.id), 'ungroup removes the boundary');
        check(
            nodes.filter((n) => n.id === 'n-gateway' || n.id === 'n-auth').every((n) => !n.parentId),
            'and keeps what was inside it',
        );

        await select(p, ['n-gateway']);
        await rightClickNode(p, 'n-gateway');
        await clickMenu(p, 'Copy style');
        await select(p, ['n-note']);
        await rightClickNode(p, 'n-note');
        check(
            !(await p
                .locator('.canvas-context-menu button:has(span:text-is("Paste style"))')
                .isDisabled()),
            'paste style is enabled once a style is copied',
        );
        await clickMenu(p, 'Paste style');
        check(
            (await nodeById(p, 'n-note'))?.data.color === '#ff0000',
            "paste style applies the copied node's color",
        );

        await select(p, ['n-note']);
        await rightClickNode(p, 'n-note');
        await p.hover('.canvas-context-menu button:has(span:text-is("Link requirement"))');
        await p.waitForSelector('.requirement-link-panel');
        const firstReq = (await p.textContent(
            '.requirement-link-panel__option .requirement-linker__option-id',
        ))!.trim();
        await p.click('.requirement-link-panel__option >> nth=0');
        await p.waitForTimeout(150);
        check(
            ((await nodeById(p, 'n-note'))?.data.linkedRequirementIds as string[] | undefined)?.includes(
                firstReq,
            ) ?? false,
            `link requirement links ${firstReq}`,
        );
        check(
            (await p.locator('.requirement-link-panel').count()) === 1,
            'the submenu stays open for linking several in a row',
        );
        await p.keyboard.press('Escape');

        console.log('=== Context menu on an edge ===');
        await p.click('.react-flow__pane', {position: {x: 5, y: 5}});
        await rightClickEdge(p, 'e2');
        const edgeItems = await menuItems(p);
        check(
            edgeItems.includes('Change color') && edgeItems.includes('Copy style'),
            'an edge gets color and style commands',
        );
        check(
            !edgeItems.includes('Duplicate') && !edgeItems.includes('Bring to front'),
            'and no node-only commands',
        );
        await clickMenu(p, 'Paste style');
        check(
            (await edgeById(p, 'e2'))?.data?.color === '#ff0000',
            "a node's style pastes its color onto an edge",
        );

        console.log('=== Single edge Inspector ===');
        await select(p, [], ['e2']);
        const labels = await p.$$eval('.inspector .inspector__field > span', (els) =>
            els.map((e) => e.textContent),
        );
        check(
            labels.includes('Thickness') && labels.includes('Routing') && labels.includes('Color'),
            'the edge panel has color, thickness and routing',
        );
        await p.click('.inspector button[role="radio"]:has-text("Straight")');
        await p.waitForTimeout(150);
        check(
            (await edgeById(p, 'e2'))?.data?.routing === 'straight',
            'routing can be set to straight',
        );
        const d = await p.$eval(
            '.react-flow__edge[data-id="e2"] path.typed-edge',
            (el) => el.getAttribute('d') ?? '',
        );
        check(!/[CQ]/.test(d), `a straight edge has no curves or rounded corners (${d})`);
        await p.click('.inspector button[role="radio"]:has-text("Orthogonal")');
        await p.waitForTimeout(150);
        check(
            (await edgeById(p, 'e2'))?.data?.routing === undefined,
            'orthogonal is stored as the default (absent)',
        );

        console.log('=== Shortcuts ===');
        await select(p, ['n-auth']);
        const n0 = (await rootNodes(p)).length;
        await p.keyboard.press('Control+d');
        await p.waitForTimeout(150);
        check((await rootNodes(p)).length === n0 + 1, 'Ctrl+D duplicates');
    } finally {
        await browser?.close();
        servers?.stop();
    }
}

run()
    .then(() => {
        console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
