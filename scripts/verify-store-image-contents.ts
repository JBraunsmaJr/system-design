/**
 * Everything the store needs at runtime is in its image (WS8-R9).
 *
 * The image copies directories, and the store imports one module from
 * outside its own: the crypto seam it shares with the editor. Copying
 * `store` alone produced an image that built cleanly and then died on the
 * first run with "Cannot find module /app/src/crypto/hash.ts" - the kind of
 * failure a build cannot catch and a person only sees in a deployment.
 *
 * This walks the store's real import graph from its entry point and checks
 * every local file it reaches is under a path the Dockerfile copies. No
 * Docker needed, so it runs in the ordinary suite.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, relative, resolve } from 'path';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const root = resolve('.');
const dockerfile = readFileSync('docker/store/Dockerfile', 'utf8');

/** Sources copied into the image, as repository-relative directories. */
const copied = [...dockerfile.matchAll(/^COPY\s+(?!--)(.+?)\s+\S+\s*$/gm)]
  .flatMap((match) => match[1].trim().split(/\s+/))
  .filter((source) => source !== '.' && !source.startsWith('--'));

/** Every local file reachable from the entry point. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:from|import)\s+["'](\.[^"']+)["']/g)) {
      queue.push(resolve(dirname(file), match[1]));
    }
  }
  return [...seen].map((file) => relative(root, file).replace(/\\/g, '/'));
}

const reachable = importGraph('store/src/main.ts');
console.log(`=== ${reachable.length} files reachable from store/src/main.ts ===`);

const outside = reachable.filter((file) => !file.startsWith('store/'));
console.log(`  (${outside.length} of them outside store/: ${outside.join(', ') || 'none'})`);

const missing = reachable.filter(
  (file) => !copied.some((source) => file === source || file.startsWith(`${source}/`)),
);
check(
  missing.length === 0,
  missing.length === 0
    ? `every file the store imports is copied into the image (COPY ${copied.join(', ')})`
    : `these are imported but never copied into the image: ${missing.join(', ')}`,
);

// The schema is read at runtime, not imported, so the graph cannot see it.
check(
  copied.some(
    (source) => 'store/schema.sql' === source || 'store/schema.sql'.startsWith(`${source}/`),
  ),
  'and so is schema.sql, which is read at startup rather than imported',
);

check(
  /CMD .*store\/src\/main\.ts/.test(dockerfile),
  'the image runs the entry point this was checked against',
);

console.log('\n=== Recovery CLI tools packaged in the store image ===');
for (const cliScript of ['scripts/generate-recovery-key.ts', 'scripts/recover-document.ts']) {
  const cliReachable = importGraph(cliScript);
  const cliMissing = cliReachable.filter(
    (file) => !copied.some((source) => file === source || file.startsWith(`${source}/`)),
  );
  check(
    cliMissing.length === 0,
    `${cliScript} and its dependencies (${cliReachable.join(', ')}) are copied into the image`,
  );
}

check(
  /ENTRYPOINT\s+\[.*docker-entrypoint\.sh.*\]/.test(dockerfile),
  'the image configures docker-entrypoint.sh as its ENTRYPOINT',
);

const entrypointContent = readFileSync('docker/store/docker-entrypoint.sh', 'utf8');
check(
  entrypointContent.includes('generate-recovery-key') &&
    entrypointContent.includes('recover-document'),
  'docker-entrypoint.sh dispatches generate-recovery-key and recover-document',
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll store image content checks passed.');
