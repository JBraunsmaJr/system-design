/**
 * Scenario export must work on an air-gapped network. Builds the app and
 * checks the production output, which is what such a network actually runs:
 *
 * - every chunk the export can load (the dialog, its encoders, the encoding
 *   worker and what it imports) is a file in the build, loaded by a relative
 *   path from the app's own origin - never from a CDN;
 * - none of them names a CDN or any other outside host to load from;
 * - all of them are in the service worker's precache, so an installed app
 *   exports with no network at all.
 *
 * The browser suite (verify-scenario-export-browser.ts) checks the same at
 * runtime, against the dev server: no request leaves the app while exporting.
 *
 * Run with: npx tsx scripts/verify-scenario-export-airgap.ts
 */
import {spawnSync} from 'child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

let failures = 0;

function check(condition: boolean, message: string) {
    if (condition) console.log(`  ✓ ${message}`);
    else {
        failures++;
        console.error(`  FAIL: ${message}`);
    }
}

/**
 * URLs that may appear in export chunks because they are text, not loads:
 * Mediabunny's MPL-2.0 license headers and the specs its error messages
 * cite; the RFCs react-pdf's PDF writer cites in its string handling, and
 * the XMP namespace names it writes into a PDF's metadata (identifiers, never
 * fetched); and React's error-decoder links in its error messages.
 * Anything else is a failure until someone looks at it.
 */
const ALLOWED_URL_TEXT = [
    /^https?:\/\/mozilla\.org\/MPL\/2\.0\/?/,
    /^https:\/\/tools\.ietf\.org\/html\/rfc\d+/,
    /^http:\/\/ns\.adobe\.com\/(pdf\/1\.3|xap\/1\.0)\/$/,
    /^http:\/\/purl\.org\/dc\/elements\/1\.1\/$/,
    /^http:\/\/www\.aiim\.org\/pdfu?a\/ns\/id\/$/,
    /^http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#$/,
    /^https:\/\/react\.dev\/errors\/$/,
    /^https:\/\/reactjs\.org\/docs\/error-decoder\.html\?invariant=$/,
    /^https:\/\/www\.w3\.org\/TR\//,
    /^https:\/\/www\.webmproject\.org\/vp9\/mp4\//,
    /^https:\/\/aomediacodec\.github\.io\/av1-isobmff\//,
];
const CDN_HOSTS =
    /unpkg\.com|jsdelivr\.net|cdnjs\.|googleapis\.com|gstatic\.com|esm\.sh|skypack\.dev|esm\.run/;

const outDir = mkdtempSync(join(tmpdir(), 'scenario-airgap-'));
try {
    console.log('=== Building the app ===');
    const build = spawnSync(
        process.execPath,
        [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'],
        {encoding: 'utf8'},
    );
    check(build.status === 0, 'the production build succeeds');
    if (build.status !== 0) {
        console.error(build.stdout, build.stderr);
        process.exit(1);
    }
    const assets = join(outDir, 'assets');
    const files = new Set(readdirSync(assets));
    const read = (name: string) => readFileSync(join(assets, name), 'utf8');

    // What loads at startup is the app itself, not the export: the walk below
    // stops there rather than sweeping the whole app.
    const indexHtml = readFileSync(join(outDir, 'index.html'), 'utf8');
    const startup = new Set(
        [...indexHtml.matchAll(/assets\/([\w.-]+\.(?:js|mjs|css))/g)].map((m) => m[1]),
    );

    const entry = [...files].find((f) => /^ScenarioExportDialog-[\w-]+\.js$/.test(f));
    check(entry !== undefined, 'the export dialog is its own lazily loaded chunk');
    if (!entry) process.exit(1);
    check(!startup.has(entry), 'the export dialog is not loaded at startup');

    // Every chunk reachable from the dialog, by the references Rollup emits:
    // "./name-hash.js" for imports, ".../assets/name-hash.js" for workers.
    const reachable = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
        const name = queue.pop()!;
        if (reachable.has(name) || startup.has(name)) continue;
        reachable.add(name);
        const code = read(name);
        for (const m of code.matchAll(/["'`](?:\.\/|[\w/.-]*\/assets\/)([\w.-]+\.m?js)["'`]/g)) {
            check(files.has(m[1]), `${name} loads ${m[1]}, which is in the build`);
            queue.push(m[1]);
        }
    }
    const worker = [...reachable].find((f) => f.startsWith('scenarioVideo.worker-'));
    check(worker !== undefined, 'the encoding worker is a chunk the dialog reaches');
    if (worker) {
        const imports = [...read(worker).matchAll(/import\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(
            (m) => m[1],
        );
        check(
            imports.length >= 2 && imports.every((i) => i.startsWith('./')),
            `the worker loads its encoders by relative path (${imports.join(', ')})`,
        );
    }
    console.log(`  (${reachable.size} export chunks: ${[...reachable].sort().join(', ')})`);

    console.log('=== Nothing is loaded from outside the app ===');
    for (const name of reachable) {
        const code = read(name);
        check(!CDN_HOSTS.test(code), `${name} names no CDN`);
        const urls = [...code.matchAll(/https?:\/\/[^\s"'`)\\]+/g)].map((m) => m[0]);
        const unexpected = urls.filter((u) => !ALLOWED_URL_TEXT.some((re) => re.test(u)));
        check(
            unexpected.length === 0,
            `${name} has no outside URLs (${unexpected.slice(0, 3).join(', ')})`,
        );
        check(!/importScripts\(/.test(code), `${name} does not use importScripts`);
    }

    console.log('=== Works offline once installed ===');
    const swPath = join(outDir, 'sw.js');
    check(existsSync(swPath), 'the service worker is generated');
    const sw = existsSync(swPath) ? readFileSync(swPath, 'utf8') : '';
    const precached = new Set(
        [...sw.matchAll(/url:\s*["'`]assets\/([^"'`]+)["'`]/g)].map((m) => m[1]),
    );
    for (const name of reachable) {
        check(precached.has(name), `${name} is precached`);
    }
} finally {
    rmSync(outDir, {recursive: true, force: true});
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nScenario export is air-gap safe.');
