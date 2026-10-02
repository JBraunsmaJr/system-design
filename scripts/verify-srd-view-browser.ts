/**
 * The SRD view in a real browser: snapshots render on the offscreen capture
 * surface from the document alone, never moving the user's canvas, and every
 * choice about them is document content that survives a reload.
 *
 * Run with: npx tsx scripts/verify-srd-view-browser.ts
 * CHROMIUM_PATH may point at a Chromium build other than Playwright's own.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { startDevServers, type DevServers } from './lib/devServers';

type FixtureNode = {
  id: string;
  data: { linkedRequirementIds?: string[]; subDiagram?: { nodes: FixtureNode[] } };
};

// The 0.8 fixture, with one requirement linked at the root and one inside a
// sub-diagram, so both kinds of level are captured.
const fixture = JSON.parse(readFileSync(resolve('fixtures/schema-0.8.json'), 'utf8')) as {
  nodes: FixtureNode[];
  srd: { framing: Record<string, unknown> };
};
const ROOT_ITEM = 'REQ-1';
const NESTED_ITEM = 'TICKET-1';
fixture.nodes.find((n) => n.id === 'n-gateway')!.data.linkedRequirementIds = [ROOT_ITEM];
fixture.nodes
  .find((n) => n.id === 'n-auth')!
  .data.subDiagram!.nodes.find((n) => n.id === 'l1-a')!.data.linkedRequirementIds = [NESTED_ITEM];
// The fixture hides REQ-1's snapshot; this suite needs it shown.
delete fixture.srd.framing[ROOT_ITEM];
const FILE = join(mkdtempSync(join(tmpdir(), 'srd-view-')), 'srd-linked.json');
writeFileSync(FILE, JSON.stringify(fixture));

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const ITEM_IMG = '.srd-doc__item-snapshot-img';
const DIAGRAM_IMG = '.srd-doc__diagram-img';

async function openSrd(p: Page) {
  await p.click('button[title^="Solution Requirement Document"]');
  await p.waitForSelector('.srd-view');
}

const imageSizes = (p: Page, selector: string) =>
  p.$$eval(selector, (els) =>
    els.map((el) => (el as HTMLImageElement).naturalWidth).filter((w) => w > 0),
  );

const itemImageSrc = (p: Page, itemId: string) =>
  p.$eval(`img[alt="Context snapshot for ${itemId}"]`, (el) => (el as HTMLImageElement).src);

async function run() {
  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  try {
    servers = await startDevServers({ vitePort: 5187, signalingPort: 14454, quiet: true });
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
    });
    const p = await (await browser.newContext()).newPage();
    p.on('pageerror', (e) => {
      failures++;
      console.error(`  FAIL: page threw: ${e.message}`);
    });
    // Every request for the new renderer's libraries, to prove they load
    // only when it is turned on.
    const pdfLibraryRequests: string[] = [];
    p.on('request', (r) => {
      if (/react-pdf|pdfjs/.test(r.url())) pdfLibraryRequests.push(r.url());
    });

    await p.goto(servers.appUrl);
    await p.waitForSelector('.collab-panel__trigger');
    await p.setInputFiles('input[type="file"][accept="application/json"]', FILE);
    await sleep(300);
    const rootNodes = await p.$$eval('.react-flow__node', (els) => els.length);

    console.log('=== Snapshots render offscreen from the document ===');
    await openSrd(p);
    await p.waitForFunction(
      ([item, diagram]) =>
        document.querySelectorAll(item).length === 2 && document.querySelector(diagram) !== null,
      [ITEM_IMG, DIAGRAM_IMG],
      { timeout: 30000 },
    );
    check(true, 'the diagram and both linked requirements are rendered');
    check(
      JSON.stringify(await imageSizes(p, DIAGRAM_IMG)) === '[3200]',
      'the diagram is captured at the pinned 2x pixel ratio (3200px wide)',
    );
    check(
      JSON.stringify(await imageSizes(p, ITEM_IMG)) === '[2400,2400]',
      'requirement snapshots are captured at the pinned 2x pixel ratio (2400px wide)',
    );
    await p.waitForFunction(
      () => document.querySelectorAll('.srd-capture-surface .react-flow').length === 0,
      null,
      { timeout: 10000 },
    );
    check(true, 'the capture surface releases its canvas once everything is rendered');

    console.log("=== The user's canvas never moves ===");
    await p.click('button[title="Diagram"]');
    await p.waitForSelector('.react-flow__node');
    check(
      (await p.$$eval('.react-flow__node', (els) => els.length)) === rootNodes,
      'returning to the diagram shows the same level as before',
    );

    console.log('=== Returning reuses rendered snapshots ===');
    await openSrd(p);
    await p.waitForFunction((sel) => document.querySelectorAll(sel).length === 2, ITEM_IMG, {
      timeout: 1500,
    });
    check(true, 'snapshots are shown again without re-rendering');

    console.log('=== The new PDF engine previews and exports the actual PDF ===');
    check(pdfLibraryRequests.length === 0, 'react-pdf and pdf.js are not loaded until asked for');
    // The images the document shows, by the HTML preview: the PDF must carry
    // exactly these.
    const shownImages = (await p.$$(`${DIAGRAM_IMG}, ${ITEM_IMG}`)).length;
    await p.check('.srd-view__renderer-toggle input');
    await p.waitForSelector('.srd-pdf-preview__pages canvas', { timeout: 60000 });
    check(pdfLibraryRequests.length > 0, 'turning the engine on loads them');
    const status = await p.textContent('.srd-pdf-preview__status');
    const shownPages = await p.$$eval('.srd-pdf-preview__pages canvas', (els) => els.length);
    check(/PDF · \d+ pages?/.test(status ?? ''), `the preview reports the PDF (${status})`);

    const [download] = await Promise.all([
      p.waitForEvent('download'),
      p.click('button:has-text("Export PDF")'),
    ]);
    const bytes = new Uint8Array(readFileSync((await download.path())!));
    check(
      new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-',
      `the export is a PDF (${download.suggestedFilename()})`,
    );
    const exported = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    check(
      exported.numPages === shownPages,
      `the export is the previewed PDF (${exported.numPages} pages, ${shownPages} shown)`,
    );
    const raw = new TextDecoder('latin1').decode(bytes);
    check(/\/BaseFont\s*\/[A-Z]{6}\+Inter/.test(raw), "the SRD's fonts are embedded");
    // Here - landscape, a diagram pushed to a new page, then cards with both
    // snapshots - the browser build of react-pdf dropped the snapshots and
    // collapsed the pages after into the footer. The steps run at this point,
    // before any snapshot is removed, because that changes the pagination.
    // An image with transparency is two image objects - the picture and its
    // alpha mask (referenced as /SMask) - so masks are not counted.
    const imageObjects = (raw.match(/\/Subtype\s*\/Image/g) ?? []).length;
    const alphaMasks = (raw.match(/\/SMask\s+\d+\s+0\s+R/g) ?? []).length;
    const images = imageObjects - alphaMasks;
    check(
      images === shownImages && shownImages >= 2,
      `every image the document shows is embedded (${images} of ${shownImages}; ${imageObjects} objects, ${alphaMasks} masks)`,
    );
    let strayText = 0;
    for (let n = 1; n <= exported.numPages; n++) {
      const content = await (await exported.getPage(n)).getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        // Body text sits above the footer band (Classic: 88pt bottom
        // padding); the footer texts sit at ~28pt. Anything between, or a
        // pile below, is content that collapsed into the footer.
        const y = item.transform[5];
        if (y > 36 && y < 80) strayText++;
      }
    }
    check(strayText === 0, `no content collapses into the footer band (${strayText} stray)`);

    // Back to the HTML preview, which the steps below inspect.
    await p.uncheck('.srd-view__renderer-toggle input');
    await p.waitForSelector(ITEM_IMG);

    console.log('=== Reframing renders that snapshot again ===');
    await p.click('button:has-text("Snapshots")');
    await p.selectOption(`select:has(option[value="${NESTED_ITEM}"])`, NESTED_ITEM);
    const before = await itemImageSrc(p, NESTED_ITEM);
    const rootBefore = await itemImageSrc(p, ROOT_ITEM);
    await p.fill('.srd-framing-slider >> nth=0', '200');
    await p.waitForFunction(
      ([item, src]) =>
        (document.querySelector(`img[alt="Context snapshot for ${item}"]`) as HTMLImageElement)
          ?.src !== src,
      [NESTED_ITEM, before],
      { timeout: 15000 },
    );
    check(true, 'the reframed snapshot is rendered again');
    check(
      (await itemImageSrc(p, ROOT_ITEM)) === rootBefore,
      'other snapshots are left as they were',
    );

    console.log('=== Removing a snapshot is document content ===');
    await p.click('button[title="Remove item snapshot"]');
    await p.waitForFunction((sel) => document.querySelectorAll(sel).length === 1, ITEM_IMG);
    check(true, 'the removed snapshot leaves the document');
    await sleep(500); // let the document reach IndexedDB
    await p.reload();
    await p.waitForSelector('.collab-panel__trigger');
    await openSrd(p);
    await p.waitForSelector(ITEM_IMG, { timeout: 30000 });
    await sleep(1000);
    check(
      (await p.$$(ITEM_IMG)).length === 1,
      'after a reload the snapshot is still removed, and the reframed one is shown',
    );
  } catch (err) {
    failures++;
    console.error('Verification failed with error:', err);
  } finally {
    await browser?.close().catch(() => {});
    servers?.stop();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll SRD view browser checks passed.');
  process.exit(0);
}

run();
