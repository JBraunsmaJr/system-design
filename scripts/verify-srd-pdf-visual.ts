/**
 * The SRD's PDF, looked at: renders fixed documents with the real engine in
 * a browser, draws every page with pdf.js, and compares the pixels with the
 * reference images in fixtures/srd-pdf-baselines/<platform>/.
 *
 * Text checks cannot see layout - overlapping cards and over-tall chips were
 * found by looking - so this looks for us.
 *
 * References are per platform, because operating systems smooth fonts
 * differently. A platform with no references yet gets them written on its
 * first run (review and commit them). After an intended visual change:
 *
 *   SRD_PDF_UPDATE_BASELINES=1 npx tsx scripts/verify-srd-pdf-visual.ts
 *
 * Run with: npx tsx scripts/verify-srd-pdf-visual.ts
 * CHROMIUM_PATH may point at a Chromium build other than Playwright's own.
 */
import { chromium, type Browser } from 'playwright';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { startDevServers, type DevServers } from './lib/devServers';

const BASELINES = resolve('fixtures/srd-pdf-baselines', process.platform);
const UPDATE = process.env.SRD_PDF_UPDATE_BASELINES === '1';
/** Rendering scale: enough to see layout, small enough to keep references light. */
const SCALE = 0.75;
/** A pixel differs when any channel is off by more than this (of 255). */
const CHANNEL_TOLERANCE = 48;
/** A page matches when at most this share of its pixels differ. */
const PAGE_TOLERANCE = 0.002;

/** The documents compared: one per layout and orientation. */
const CASES = [
  { name: 'portrait-list', layout: 'list', orientation: 'portrait' },
  { name: 'landscape-table', layout: 'table', orientation: 'landscape' },
] as const;

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const pngPath = (name: string, page: number) => join(BASELINES, `${name}-p${page}.png`);
const toDataUrl = (file: string) =>
  `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const fromDataUrl = (url: string) => Buffer.from(url.split(',')[1], 'base64');

async function run() {
  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  try {
    // Ports no other suite uses.
    servers = await startDevServers({ vitePort: 5198, signalingPort: 14467, quiet: true });
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
    });
    const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
    page.on('pageerror', (e) => {
      failures++;
      console.error(`  FAIL: page threw: ${e.message}`);
    });
    await page.goto(servers.appUrl);
    await page.waitForSelector('.collab-panel__trigger');

    for (const testCase of CASES) {
      console.log(`=== ${testCase.name} ===`);
      // Rendered in the page through the app's own modules: the real fonts,
      // engine and pdf.js. Passed as a string, so the test runner's helpers
      // never reach the page.
      const pages = (await page.evaluate(`(async () => {
        const engine = await import('/system-design/src/components/srd/pdf/srdPdfBrowser.tsx');
        const fixtures = await import('/system-design/src/components/srd/pdf/srdPdfTestData.ts');
        const pdfjs = await import('/system-design/node_modules/.vite/deps/pdfjs-dist_legacy_build_pdf__mjs.js');
        pdfjs.GlobalWorkerOptions.workerSrc = '/system-design/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs';
        const base = fixtures.config({ requirementsLayout: ${JSON.stringify(testCase.layout)} });
        const config = { ...base, theme: { ...base.theme, pageOrientation: ${JSON.stringify(testCase.orientation)} } };
        const blob = await engine.renderSrdPdfBlob(fixtures.richData(), config);
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        const out = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const p = await doc.getPage(n);
          const viewport = p.getViewport({ scale: ${SCALE} });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await p.render({ canvas, viewport }).promise;
          out.push(canvas.toDataURL('image/png'));
        }
        return out;
      })()`)) as string[];

      const existing = existsSync(BASELINES)
        ? readdirSync(BASELINES).filter((f) => f.startsWith(`${testCase.name}-p`))
        : [];

      if (UPDATE || existing.length === 0) {
        mkdirSync(BASELINES, { recursive: true });
        for (const f of existing) rmSync(join(BASELINES, f));
        pages.forEach((url, i) => writeFileSync(pngPath(testCase.name, i + 1), fromDataUrl(url)));
        console.log(
          `  • wrote ${pages.length} reference page(s) for ${process.platform} - review and commit them`,
        );
        continue;
      }

      check(
        pages.length === existing.length,
        `page count matches the reference (${pages.length} vs ${existing.length})`,
      );

      for (let i = 0; i < Math.min(pages.length, existing.length); i++) {
        // Compared in the page, which decodes PNGs natively: no image
        // libraries needed here.
        const result = (await page.evaluate(`(async () => {
          const load = (src) => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });
          const [actual, expected] = await Promise.all([load(${JSON.stringify(pages[i])}), load(${JSON.stringify(toDataUrl(pngPath(testCase.name, i + 1)))})]);
          if (actual.width !== expected.width || actual.height !== expected.height) {
            return { sizeMismatch: [actual.width, actual.height, expected.width, expected.height] };
          }
          const pixels = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
          const a = pixels(actual), e = pixels(expected);
          const diff = document.createElement('canvas'); diff.width = a.width; diff.height = a.height;
          const dctx = diff.getContext('2d'); const d = dctx.createImageData(a.width, a.height);
          let differing = 0;
          for (let p = 0; p < a.data.length; p += 4) {
            const off = Math.max(Math.abs(a.data[p] - e.data[p]), Math.abs(a.data[p + 1] - e.data[p + 1]), Math.abs(a.data[p + 2] - e.data[p + 2]));
            const bad = off > ${CHANNEL_TOLERANCE};
            if (bad) differing++;
            // Differences in red over a faded copy of the reference.
            d.data[p] = bad ? 255 : 255 - (255 - e.data[p]) / 4;
            d.data[p + 1] = bad ? 0 : 255 - (255 - e.data[p + 1]) / 4;
            d.data[p + 2] = bad ? 0 : 255 - (255 - e.data[p + 2]) / 4;
            d.data[p + 3] = 255;
          }
          dctx.putImageData(d, 0, 0);
          return { ratio: differing / (a.width * a.height), diff: diff.toDataURL('image/png') };
        })()`)) as { ratio?: number; diff?: string; sizeMismatch?: number[] };

        if (result.sizeMismatch) {
          check(false, `page ${i + 1} has the reference's size (${result.sizeMismatch.join(' ')})`);
          continue;
        }
        const ratio = result.ratio ?? 1;
        const ok = ratio <= PAGE_TOLERANCE;
        if (!ok && result.diff) {
          const out = join(tmpdir(), `srd-pdf-diff-${testCase.name}-p${i + 1}.png`);
          writeFileSync(out, fromDataUrl(result.diff));
          console.error(`    diff image: ${out}`);
        }
        check(ok, `page ${i + 1} matches (${(ratio * 100).toFixed(3)}% of pixels differ)`);
      }
    }
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
  console.log('\nAll SRD PDF visual checks passed.');
  process.exit(0);
}

run();
