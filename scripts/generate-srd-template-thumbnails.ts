/**
 * Generates the template picker's thumbnails: page one of the shared test
 * document (srdPdfTestData) drawn by each template with the real engine, in
 * a browser, written to public/srd-templates/<id>.png.
 *
 * Re-run after changing how a template looks:
 *   npx tsx scripts/generate-srd-template-thumbnails.ts
 * CHROMIUM_PATH may point at a Chromium build other than Playwright's own.
 */
import {type Browser, chromium} from 'playwright';
import {mkdirSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';
import {type DevServers, startDevServers} from './lib/devServers';
import {SRD_TEMPLATE_CATALOG} from '../src/domain/srd/srdTemplateCatalog';

const OUT = resolve('public/srd-templates');
/** Two device pixels per CSS pixel at the picker's card width. */
const WIDTH_PX = 240;

async function run() {
  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  try {
    // Ports no other script or suite uses.
    servers = await startDevServers({ vitePort: 5199, signalingPort: 14468, quiet: true });
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
    });
    const page = await (await browser.newContext()).newPage();
    await page.goto(servers.appUrl);
    await page.waitForSelector('.collab-panel__trigger');
    mkdirSync(OUT, { recursive: true });

    for (const id of Object.keys(SRD_TEMPLATE_CATALOG)) {
      // Passed as a string, so the test runner's helpers never reach the page.
      const dataUrl = (await page.evaluate(`(async () => {
        const engine = await import('/system-design/src/components/srd/pdf/srdPdfBrowser.tsx');
        const fixtures = await import('/system-design/src/components/srd/pdf/srdPdfTestData.ts');
        const pdfjs = await import('/system-design/node_modules/.vite/deps/pdfjs-dist_legacy_build_pdf__mjs.js');
        pdfjs.GlobalWorkerOptions.workerSrc = '/system-design/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs';
        const config = fixtures.config({ requirementsLayout: 'list', templateId: ${JSON.stringify(id)} });
        const blob = await engine.renderSrdPdfBlob(fixtures.richData(), config);
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        const first = await doc.getPage(1);
        const viewport = first.getViewport({ scale: ${WIDTH_PX} / first.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await first.render({ canvas, viewport }).promise;
        return canvas.toDataURL('image/png');
      })()`)) as string;
      const file = join(OUT, `${id}.png`);
      writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`  wrote ${file}`);
    }
  } finally {
    await browser?.close().catch(() => {});
    servers?.stop();
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error('Thumbnail generation failed:', err);
    process.exit(1);
  },
);
