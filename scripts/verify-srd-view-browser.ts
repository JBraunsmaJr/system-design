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
import { createHash } from 'crypto';
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

/** Opens the SRD view; its preview is the PDF itself. */
async function openSrd(p: Page) {
  await p.click('button[title^="Solution Requirement Document"]');
  await p.waitForSelector('.srd-view');
}

interface PdfImage {
  width: number;
  height: number;
  /** A hash of the image's data: equal for an unchanged image. */
  digest: string;
}

/**
 * The images in a PDF - the diagram and snapshots a reader gets - with
 * their pixel sizes. Alpha masks (another image's /SMask) are not images of
 * their own and are left out.
 */
function imagesOf(bytes: Buffer): PdfImage[] {
  const raw = bytes.toString('latin1');
  const masks = new Set([...raw.matchAll(/\/SMask\s+(\d+)\s+0\s+R/g)].map((m) => m[1]));
  const images: PdfImage[] = [];
  // Each object's dictionary, never running past its own endobj into the
  // next object's - which would count a mask as an image.
  for (const m of raw.matchAll(/(\d+)\s+0\s+obj\s*<<((?:(?!endobj)[\s\S])*?)>>\s*stream\r?\n/g)) {
    const [whole, id, dict] = m;
    if (!/\/Subtype\s*\/Image/.test(dict) || masks.has(id)) continue;
    const start = (m.index ?? 0) + whole.length;
    const end = raw.indexOf('endstream', start);
    images.push({
      width: Number(/\/Width\s+(\d+)/.exec(dict)?.[1]),
      height: Number(/\/Height\s+(\d+)/.exec(dict)?.[1]),
      digest: createHash('sha1').update(bytes.subarray(start, end)).digest('hex'),
    });
  }
  return images;
}

/** Exports the SRD from the view, as a user would, and returns the file. */
async function exportPdf(p: Page): Promise<{ bytes: Buffer; name: string }> {
  const [download] = await Promise.all([
    p.waitForEvent('download'),
    p.click('button:has-text("Export PDF")'),
  ]);
  return { bytes: readFileSync((await download.path())!), name: download.suggestedFilename() };
}

/** Exports until `ready` accepts the PDF's images: snapshots are captured
 * in the background, so the first export may predate them. */
async function exportWhen(
  p: Page,
  ready: (images: PdfImage[]) => boolean,
  timeoutMs = 30000,
): Promise<PdfImage[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const images = imagesOf((await exportPdf(p)).bytes);
    if (ready(images) || Date.now() > deadline) return images;
    await sleep(1000);
  }
}

async function run() {
  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  try {
    // Ports no other suite uses, so suites never collide when run together.
    servers = await startDevServers({ vitePort: 5197, signalingPort: 14466, quiet: true });
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
    });
    const p = await (await browser.newContext()).newPage();
    p.on('pageerror', (e) => {
      failures++;
      console.error(`  FAIL: page threw: ${e.message}`);
    });
    // The PDF worker must load; falling back to the main thread is for
    // browsers without workers, not something to pass unnoticed here.
    p.on('console', (m) => {
      if (m.text().includes('SRD PDF worker failed')) {
        failures++;
        console.error(`  FAIL: ${m.text()}`);
      }
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
    check(
      pdfLibraryRequests.length === 0,
      'react-pdf and pdf.js are not loaded until the SRD view opens',
    );
    await sleep(300);
    const rootNodes = await p.$$eval('.react-flow__node', (els) => els.length);

    console.log('=== Snapshots render offscreen from the document ===');
    await openSrd(p);
    check(pdfLibraryRequests.length > 0, 'opening the SRD view loads the PDF engine');
    await p.waitForSelector('.srd-pdf-preview__pages canvas', { timeout: 60000 });
    const isComplete = (images: PdfImage[]) => images.length === 3;
    const captured = await exportWhen(p, isComplete);
    check(
      isComplete(captured),
      `the diagram and both linked requirements are in the PDF (${captured.length} images)`,
    );
    check(
      captured.filter((i) => i.width === 1600).length === 1,
      'the diagram is captured at the pinned pixel ratio (1600px wide, ~300 DPI as placed)',
    );
    check(
      captured.filter((i) => i.width === 1200).length === 2,
      'requirement snapshots are captured at the pinned pixel ratio (1200px wide)',
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
    // The capture surface mounts a canvas only to render a snapshot; with
    // every snapshot cached it never does.
    await p.evaluate(() => {
      const w = window as unknown as { __surfaceMounted?: boolean };
      w.__surfaceMounted = false;
      new MutationObserver(() => {
        if (document.querySelector('.srd-capture-surface .react-flow')) w.__surfaceMounted = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await openSrd(p);
    await p.waitForSelector('.srd-pdf-preview__pages canvas', { timeout: 60000 });
    const reused = await exportWhen(p, isComplete, 5000);
    const surfaceMounted = await p.evaluate(
      () => (window as unknown as { __surfaceMounted?: boolean }).__surfaceMounted,
    );
    check(isComplete(reused) && !surfaceMounted, 'snapshots are reused without rendering again');
    console.log('=== The new PDF engine previews and exports the actual PDF ===');
    await p.waitForSelector('.srd-pdf-preview__pages canvas', { timeout: 60000 });
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
      images === 3,
      `the diagram and both snapshots are embedded (${images} images; ${imageObjects} objects, ${alphaMasks} masks)`,
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

    console.log('=== The page stays responsive while the PDF renders ===');
    // The PDF is built in a worker: typing while it re-renders must never
    // wait on it. (Snapshot capture needs the page and is excluded: every
    // snapshot is cached by now.) A long task is the browser's measure of
    // the page being unable to respond.
    await p.evaluate(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
      }).observe({ entryTypes: ['longtask'] });
    });
    const titleInput = p.locator('.srd-sidebar input').first();
    await titleInput.click();
    await titleInput.press('End');
    for (const ch of ' revised') {
      await p.keyboard.type(ch);
      await sleep(350); // past the preview's debounce, so renders start between keys
    }
    await p.waitForFunction(
      () => document.querySelector('.srd-pdf-preview')?.getAttribute('aria-busy') === 'false',
      null,
      { timeout: 30000 },
    );
    const longTasks = await p.evaluate(
      () => (window as unknown as { __longTasks: number[] }).__longTasks,
    );
    const longest = Math.round(Math.max(0, ...longTasks));
    check(longest < 200, `typing never waits on a render (longest freeze ${longest}ms)`);

    console.log('=== Reframing renders that snapshot again ===');
    const beforeReframe = await exportWhen(p, isComplete);
    await p.click('button:has-text("Snapshots")');
    await p.selectOption(`select:has(option[value="${NESTED_ITEM}"])`, NESTED_ITEM);
    await p.fill('.srd-framing-slider >> nth=0', '200');
    const digests = (images: PdfImage[]) => new Set(images.map((i) => i.digest));
    const changedFrom = (images: PdfImage[]) =>
      images.filter((i) => !digests(beforeReframe).has(i.digest));
    const afterReframe = await exportWhen(p, (images) => changedFrom(images).length > 0, 20000);
    const changed = changedFrom(afterReframe);
    check(
      changed.length === 1 && changed[0].width === 1200,
      'the reframed snapshot is rendered again',
    );
    check(
      afterReframe.length === 3 &&
        afterReframe.filter((i) => digests(beforeReframe).has(i.digest)).length === 2,
      'the other snapshot and the diagram are left as they were',
    );

    console.log('=== Removing a snapshot is document content ===');
    await p.click('button[title="Remove item snapshot"]');
    const afterRemoval = await exportWhen(p, (images) => images.length === 2, 15000);
    check(afterRemoval.length === 2, 'the removed snapshot leaves the PDF');
    await sleep(500); // let the document reach IndexedDB
    await p.reload();
    await p.waitForSelector('.collab-panel__trigger');
    await openSrd(p);
    await p.waitForSelector('.srd-pdf-preview__pages canvas', { timeout: 60000 });
    const afterReload = await exportWhen(p, (images) => images.length >= 2, 30000);
    await sleep(1500);
    const settled = imagesOf((await exportPdf(p)).bytes);
    check(
      afterReload.length === 2 && settled.length === 2,
      'after a reload the snapshot is still removed',
    );

    console.log('=== The template picker ===');
    const pressedTemplate = () =>
      p.$eval('.srd-template-picker__option[aria-pressed="true"]', (el) =>
        el.querySelector('.srd-template-picker__name')?.textContent?.trim(),
      );
    await p.click('button:has-text("Theme")');
    await p.waitForSelector('.srd-template-picker__option');
    check((await p.$$('.srd-template-picker__option')).length === 3, 'offers all three templates');
    await p.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLImageElement>('.srd-template-picker__thumbnail')].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      null,
      { timeout: 10000 },
    );
    check(true, 'with a thumbnail each');
    check((await pressedTemplate()) === 'Classic', 'Classic is chosen by default');
    await p.click('.srd-template-picker__option:has-text("Engineering")');
    await p.waitForFunction(() =>
      document
        .querySelector('.srd-template-picker__option[aria-pressed="true"]')
        ?.textContent?.includes('Engineering'),
    );
    check(true, 'choosing Engineering selects it');
    await sleep(500); // let the document reach IndexedDB
    await p.reload();
    await p.waitForSelector('.collab-panel__trigger');
    await openSrd(p);
    await p.click('button:has-text("Theme")');
    await p.waitForSelector('.srd-template-picker__option');
    check(
      (await pressedTemplate()) === 'Engineering',
      'the choice is document content: it survives a reload',
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
