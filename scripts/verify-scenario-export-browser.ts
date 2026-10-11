/**
 * Scenario export in a real browser: every format is exported from the
 * fixture's multi-level scenario, as a user would, and the files are checked.
 *
 * Also the air-gap guarantee: while exporting, the page must not request
 * anything from any host but its own - no CDN, no font service. And the
 * encoders (fflate, gifenc, Mediabunny, react-pdf) load only when used.
 *
 * Run with: npx tsx scripts/verify-scenario-export-browser.ts
 * CHROMIUM_PATH may point at a Chromium build other than Playwright's own.
 * SCENARIO_EXPORT_OUT=<dir> keeps the exported files there, to look at.
 */
import {type Browser, chromium, type Page} from 'playwright';
import {mkdtempSync, readFileSync, writeFileSync} from 'fs';
import {createHash} from 'crypto';
import {unzipSync} from 'fflate';
import {BufferSource, Input, MP4} from 'mediabunny';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';
import {type DevServers, startDevServers} from './lib/devServers';

// The 0.8 fixture's "Login flow": two root steps, then one inside n-auth's
// sub-diagram - so a level change is exported too.
const FILE = join(mkdtempSync(join(tmpdir(), 'scenario-export-')), 'scenario.json');
writeFileSync(FILE, readFileSync(resolve('fixtures/schema-0.8.json')));
const STEPS = 3;

let failures = 0;

function check(condition: boolean, message: string) {
    if (condition) console.log(`  ✓ ${message}`);
    else {
        failures++;
        console.error(`  FAIL: ${message}`);
    }
}

interface Exported {
    bytes: Buffer;
    name: string;
}

/** Picks a format in the open dialog, exports, and returns the download. */
async function exportAs(p: Page, format: string, setup?: () => Promise<void>): Promise<Exported> {
    await p.click(`.scenario-export__format:has(input[value="${format}"])`);
    await setup?.();
    const [download] = await Promise.all([
        p.waitForEvent('download', {timeout: 120000}),
        p.click('.scenario-export button:has-text("Export")'),
    ]);
    await p.waitForSelector('.scenario-export__status-text:has-text("Saved")');
    const bytes = readFileSync((await download.path())!);
    const name = download.suggestedFilename();
    if (process.env.SCENARIO_EXPORT_OUT)
        writeFileSync(join(process.env.SCENARIO_EXPORT_OUT, name), bytes);
    return {bytes, name};
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {width: view.getUint32(16), height: view.getUint32(20)};
}

/** A GIF's logical screen size and how many image frames it has. */
function gifInfo(bytes: Buffer): { width: number; height: number; frames: number; loops: boolean } {
    const width = bytes.readUInt16LE(6);
    const height = bytes.readUInt16LE(8);
    const packed = bytes[10];
    let pos = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
    let frames = 0;
    let loops = false;
    const skipSubBlocks = () => {
        while (bytes[pos] !== 0) pos += bytes[pos] + 1;
        pos++;
    };
    while (pos < bytes.length) {
        const block = bytes[pos++];
        if (block === 0x3b) break; // trailer
        if (block === 0x21) {
            const label = bytes[pos++];
            if (label === 0xff && bytes.toString('latin1', pos + 1, pos + 12) === 'NETSCAPE2.0')
                loops = true;
            skipSubBlocks();
        } else if (block === 0x2c) {
            frames++;
            const flags = bytes[pos + 8];
            pos += 9;
            if (flags & 0x80) pos += 3 * (1 << ((flags & 7) + 1));
            pos++; // LZW minimum code size
            skipSubBlocks();
        } else break;
    }
    return {width, height, frames, loops};
}

/**
 * How much of an image's diagram area is drawn rather than empty
 * background, measured in the page (which can decode PNGs).
 */
async function drawnFraction(p: Page, png: Uint8Array): Promise<number> {
    const b64 = Buffer.from(png).toString('base64');
    return p.evaluate(async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        // The diagram band: below the header, above the caption.
        const {data: px} = g.getImageData(0, 120, img.width, 500);
        const [r0, g0, b0] = [px[0], px[1], px[2]];
        let drawn = 0;
        for (let i = 0; i < px.length; i += 16) {
            if (Math.abs(px[i] - r0) + Math.abs(px[i + 1] - g0) + Math.abs(px[i + 2] - b0) > 24) drawn++;
        }
        return drawn / (px.length / 16);
    }, b64);
}

async function run() {
    let servers: DevServers | undefined;
    let browser: Browser | undefined;
    try {
        // Ports no other suite uses, so suites never collide when run together.
        servers = await startDevServers({vitePort: 5203, signalingPort: 14472, quiet: true});
        const appOrigin = new URL(servers.appUrl).origin;
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.CHROMIUM_PATH || undefined,
        });
        const context = await browser.newContext({acceptDownloads: true});
        const p = await context.newPage();
        p.on('pageerror', (e) => {
            failures++;
            console.error(`  FAIL: page threw: ${e.message}`);
        });
        // The context's requests, not just the page's: the encoding worker's
        // module loads count too.
        p.on('console', (m) => {
            if (m.type() === 'error' || m.type() === 'warning')
                console.log(`    [console.${m.type()}] ${m.text()}`);
        });
        const requests: string[] = [];
        context.on('request', (r) => requests.push(r.url()));

        await p.goto(servers.appUrl);
        await p.waitForSelector('.collab-panel__trigger');
        await p.setInputFiles('input[type="file"][accept="application/json"]', FILE);
        await p.waitForSelector('.react-flow__node');

        const encoderLibs = /fflate|gifenc|mediabunny|react-pdf/;
        const beforeExport = requests.length;
        check(
            !requests.some((u) => encoderLibs.test(u)),
            'no encoder library is loaded before an export is started',
        );

        console.log('=== The export dialog ===');
        await p.click('button[title="Scenarios"]');
        await p.waitForSelector('.scenario-panel__btn-export');
        // Opening the panel re-frames the canvas; let it settle, then remember it.
        await p.waitForTimeout(800);
        const viewportBefore = await p.$eval('.react-flow__viewport', (el) => el.getAttribute('style'));
        await p.click('.scenario-panel__btn-export');
        await p.waitForSelector('.scenario-export');
        check(
            (await p.textContent('.scenario-export__summary'))?.includes(`${STEPS} steps`) ?? false,
            'the dialog summarizes the scenario',
        );

        console.log('=== PNG per step ===');
        const zip = await exportAs(p, 'png');
        check(zip.name === 'login-flow-steps.zip', `named after the scenario (${zip.name})`);
        const files = unzipSync(new Uint8Array(zip.bytes));
        const names = Object.keys(files).sort();
        check(
            names.join(',') ===
            ['01-request-arrives.png', '02-validate.png', '03-check-credentials.png'].join(','),
            `one numbered PNG per step (${names.join(', ')})`,
        );
        check(
            names.every((n) => {
                const {width, height} = pngSize(files[n]);
                return width === 1920 && height === 1080;
            }),
            'each PNG is 1920x1080',
        );
        const digests = new Set(names.map((n) => createHash('sha1').update(files[n]).digest('hex')));
        check(digests.size === STEPS, 'every step renders differently');
        for (const n of names) {
            const drawn = await drawnFraction(p, files[n]);
            check(drawn > 0.01, `${n} shows the diagram (${(drawn * 100).toFixed(1)}% drawn)`);
        }

        console.log('=== PDF slides ===');
        const pdf = await exportAs(p, 'pdf');
        check(pdf.name === 'login-flow.pdf', `named after the scenario (${pdf.name})`);
        const doc = await getDocument({data: new Uint8Array(pdf.bytes)}).promise;
        check(doc.numPages === STEPS + 1, `a title slide plus one slide per step (${doc.numPages})`);
        const page = await doc.getPage(2);
        const [, , w, h] = page.view;
        check(Math.round(w) === 960 && Math.round(h) === 540, `slides are 16:9 (${w}x${h} pt)`);
        const text = (await page.getTextContent()).items
            .map((i) => ('str' in i ? i.str : ''))
            .join(' ');
        check(
            text.includes('Request arrives') && text.includes('Client hits the gateway'),
            'the step title and narration are real text on the slide',
        );
        const last = (await (await doc.getPage(STEPS + 1)).getTextContent()).items
            .map((i) => ('str' in i ? i.str : ''))
            .join(' ');
        check(
            last.includes('Auth Service'),
            `the sub-diagram step names its level (${last.slice(0, 80)})`,
        );

        console.log('=== Animated GIF ===');
        const gif = await exportAs(p, 'gif');
        const info = gifInfo(gif.bytes);
        check(gif.bytes.toString('latin1', 0, 6) === 'GIF89a', 'a GIF89a file');
        check(info.width === 960 && info.height === 540, `960x540 (${info.width}x${info.height})`);
        // Three steps held, and four fade frames between each pair.
        check(info.frames === STEPS + (STEPS - 1) * 4, `holds plus crossfades (${info.frames} frames)`);
        check(info.loops, 'loops forever');
        check(
            gif.bytes.length < 5 * 1024 * 1024,
            `a reasonable size (${(gif.bytes.length / 1024).toFixed(0)} KB)`,
        );

        console.log('=== MP4 video ===');
        const mp4 = await exportAs(p, 'mp4', async () => {
            await p.selectOption('.scenario-export__field select', '3');
        });
        check(mp4.name === 'login-flow.mp4', `named after the scenario (${mp4.name})`);
        const input = new Input({
            formats: [MP4],
            source: new BufferSource(new Uint8Array(mp4.bytes)),
        });
        const track = await input.getPrimaryVideoTrack();
        check(track !== null, 'has a video track');
        if (track) {
            check(
                track.displayWidth === 1920 && track.displayHeight === 1080,
                `1920x1080 (${track.displayWidth}x${track.displayHeight})`,
            );
            check(
                (await track.getCodec()) === 'avc',
                `H.264, for PowerPoint and Keynote (${await track.getCodec()})`,
            );
        }
        const duration = await input.computeDuration();
        check(
            Math.abs(duration - STEPS * 3) < 0.2,
            `three steps of 3 seconds (${duration.toFixed(2)}s)`,
        );
        const note = await p.textContent('.scenario-export__status-text');
        check(
            !/can't encode H\.264/.test(note ?? ''),
            'no codec fallback note when H.264 is available',
        );

        console.log('=== Air-gapped: nothing leaves the app ===');
        const outside = requests.filter((u) => {
            try {
                const origin = new URL(u).origin;
                return origin !== appOrigin && !u.startsWith('data:') && !u.startsWith('blob:');
            } catch {
                return false;
            }
        });
        check(outside.length === 0, `no request to any other host (${outside.slice(0, 3).join(', ')})`);
        const exportRequests = requests.slice(beforeExport);
        check(
            ['fflate', 'gifenc', 'mediabunny', 'react-pdf'].every((lib) =>
                exportRequests.some((u) => u.includes(lib)),
            ),
            'each encoder loads from the app itself, once its format is used',
        );

        console.log("=== The user's canvas never moves ===");
        await p.keyboard.press('Escape');
        const viewportAfter = await p.$eval('.react-flow__viewport', (el) => el.getAttribute('style'));
        check(viewportAfter === viewportBefore, 'the canvas viewport is unchanged after exporting');
        check(
            (await p.$$eval('.scenario-capture-surface .react-flow', (els) => els.length)) === 0,
            'the offscreen surface releases its canvas when done',
        );
    } catch (err) {
        failures++;
        console.error('  FAIL: suite threw:', err);
    } finally {
        await browser?.close();
        servers?.stop();
    }
    if (failures > 0) {
        console.error(`\n${failures} check(s) failed`);
        process.exit(1);
    }
    console.log('\nAll scenario export checks passed.');
}

void run();
