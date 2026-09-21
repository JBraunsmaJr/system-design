/**
 * The documentation site's base path, applied at container start
 * (WS8-R9).
 *
 * VitePress writes its base into every asset URL and into the client
 * router's own configuration, so it cannot be relative the way the app's
 * build is. Baking it meant one image worked at exactly one path, and
 * failed in a way that reads as a mystery: the page loads, then the
 * router rewrites the address bar to wherever the build thought it
 * lived. The image is built with a placeholder instead, and
 * docker-entrypoint.d/45-docs-base.sh replaces it here.
 *
 * Runs the real script against a directory shaped like the built site.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const PLACEHOLDER = '/__DOCS_BASE__/';
const SCRIPT = 'docker/docker-entrypoint.d/45-docs-base.sh';

const gitSh = 'C:\\Program Files\\Git\\bin\\sh.exe';
const shellCmd = process.platform === 'win32' && existsSync(gitSh) ? gitSh : 'sh';

/** A directory shaped like the built site, with the placeholder in each
 * kind of file the rewrite has to reach. */
function builtSite(): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-base-'));
  const docs = join(root, 'docs');
  mkdirSync(join(docs, 'assets'), { recursive: true });
  mkdirSync(join(docs, 'guide'), { recursive: true });
  writeFileSync(
    join(docs, 'index.html'),
    `<link rel="stylesheet" href="${PLACEHOLDER}assets/style.css"><script>{"base":"${PLACEHOLDER}"}</script>`,
  );
  writeFileSync(join(docs, 'guide', 'security.html'), `<a href="${PLACEHOLDER}guide/workspaces">Workspaces</a>`);
  writeFileSync(join(docs, 'assets', 'app.js'), `const base = "${PLACEHOLDER}";`);
  writeFileSync(join(docs, 'assets', 'style.css'), `@font-face{src:url(${PLACEHOLDER}assets/inter.woff2)}`);
  return docs;
}

const run = (docs: string, env: Record<string, string>) =>
  execFileSync(shellCmd, [SCRIPT], {
    env: { ...process.env, DOCS_ROOT: docs.replace(/\\/g, '/'), ...env },
    encoding: 'utf8',
  });

const readAll = (docs: string) =>
  ['index.html', 'guide/security.html', 'assets/app.js', 'assets/style.css']
    .map((file) => readFileSync(join(docs, file), 'utf8'))
    .join('\n');

console.log('=== Where the docs are served ===');
{
  const docs = builtSite();
  const output = run(docs, {});
  const content = readAll(docs);
  check(/Serving documentation at \/docs\//.test(output), 'with nothing configured, /docs/ - and it says so');
  check(!content.includes(PLACEHOLDER), 'no placeholder survives, in markup, script or stylesheet');
  check(content.includes('"/docs/assets/style.css"'), 'asset URLs point at the served path');
  rmSync(docs, { recursive: true, force: true });
}
{
  const docs = builtSite();
  run(docs, { DOCS_BASE: '/help/' });
  check(readAll(docs).includes('/help/assets/style.css'), 'DOCS_BASE decides it outright');
  rmSync(docs, { recursive: true, force: true });
}
{
  // An app behind a prefix should not have to say so twice.
  const docs = builtSite();
  run(docs, { APP_URL: 'https://example.gov/system-design/' });
  check(readAll(docs).includes('/system-design/docs/assets/style.css'), "APP_URL's prefix carries the docs with it");
  rmSync(docs, { recursive: true, force: true });
}
{
  const docs = builtSite();
  run(docs, { APP_URL: 'https://example.gov' });
  check(readAll(docs).includes('"/docs/assets/style.css"'), 'an app at a domain root leaves docs at /docs/');
  rmSync(docs, { recursive: true, force: true });
}

console.log('\n=== Awkward values ===');
for (const [given, expected] of [
  ['help', '/help/'],
  ['/help', '/help/'],
  ['help/', '/help/'],
]) {
  const docs = builtSite();
  run(docs, { DOCS_BASE: given });
  check(
    readAll(docs).includes(`${expected}assets/style.css`),
    `"${given}" becomes ${expected} - a missing slash would give /helpassets/...`,
  );
  rmSync(docs, { recursive: true, force: true });
}
{
  // An image built without the docs, or a stripped-down deployment.
  const root = mkdtempSync(join(tmpdir(), 'docs-base-'));
  let threw = false;
  try {
    run(join(root, 'docs'), {});
  } catch {
    threw = true;
  }
  check(!threw, 'no documentation directory is not an error, so the container still starts');
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll documentation base checks passed.');
