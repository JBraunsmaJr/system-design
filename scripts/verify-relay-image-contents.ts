/**
 * The relay image runs the relay this project tests (WS10-R6, WS8-R9).
 *
 * The published image used to run y-webrtc's own server, while the
 * documentation said RELAY_TOKEN_SECRET made sessions require membership.
 * With that image the secret did nothing: an operator following the docs
 * got a relay that looked protected and was not. This checks the image
 * against the source rather than trusting either description of it:
 *
 *  - it runs scripts/relay-server.ts;
 *  - every file the relay imports is copied in, at the path it is
 *    imported from (the store's image once built cleanly and died on
 *    first run for want of exactly this);
 *  - every package it imports is a dependency of the image;
 *  - and, assembled the way the Dockerfile assembles it, it starts,
 *    serves /health, and honours the secret.
 */
import { spawn } from 'child_process';
import { builtinModules } from 'module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve } from 'path';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const root = resolve('.');
const dockerfile = readFileSync('docker/signaling/Dockerfile', 'utf8');
const manifest = JSON.parse(readFileSync('docker/signaling/package.json', 'utf8')) as {
  dependencies?: Record<string, string>;
};

console.log('=== What the image runs ===');
check(
  /CMD \[.*"scripts\/relay-server\.ts"\]/.test(dockerfile),
  'the image runs scripts/relay-server.ts',
);
check(
  !/y-webrtc\/bin\/server\.js/.test(dockerfile.replace(/^#.*$/gm, '')),
  "and not y-webrtc's own server, which ignores the secret",
);

/** COPY <source> <destination>, as repository-relative source paths. */
const copied = [...dockerfile.matchAll(/^COPY\s+(\S+)\s+\S+\s*$/gm)].map((match) => match[1]);

/** The relay's own files and the packages it needs. */
const localFiles: string[] = [];
const packages = new Set<string>();
{
  const queue = [resolve('scripts/relay-server.ts')];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    localFiles.push(relative(root, file).replace(/\\/g, '/'));
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else if (
        !specifier.startsWith('node:') &&
        !builtinModules.includes(specifier.split('/')[0])
      ) {
        packages.add(
          specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0],
        );
      }
    }
  }
}

console.log(`\n=== ${localFiles.length} files the relay reaches ===`);
const missing = localFiles.filter((file) => !copied.includes(file));
check(
  missing.length === 0,
  missing.length === 0
    ? `every one is copied into the image (${localFiles.join(', ')})`
    : `imported but never copied: ${missing.join(', ')}`,
);
const undeclared = [...packages].filter((name) => !manifest.dependencies?.[name]);
check(
  undeclared.length === 0,
  undeclared.length === 0
    ? `and every package it imports is a dependency of the image (${[...packages].join(', ')})`
    : `imported but not a dependency of the image: ${undeclared.join(', ')}`,
);

console.log('\n=== Assembled as the image assembles it ===');
{
  // Only what the Dockerfile copies, with its dependencies beside it.
  const image = mkdtempSync(join(tmpdir(), 'relay-image-'));
  for (const file of localFiles) {
    mkdirSync(dirname(join(image, file)), { recursive: true });
    cpSync(file, join(image, file));
  }
  try {
    symlinkSync(
      join(root, 'node_modules'),
      join(image, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch {
    for (const pkg of packages) {
      const src = join(root, 'node_modules', pkg);
      if (existsSync(src)) {
        cpSync(src, join(image, 'node_modules', pkg), { recursive: true });
      }
    }
  }

  const start = async (port: number, secret: string | null) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', 'scripts/relay-server.ts'],
      {
        cwd: image,
        env: {
          ...process.env,
          PORT: String(port),
          ...(secret ? { RELAY_TOKEN_SECRET: secret } : { RELAY_TOKEN_SECRET: '' }),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout?.on('data', (chunk) => (output += String(chunk)));
    child.stderr?.on('data', (chunk) => (output += String(chunk)));
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok)
          return {
            child,
            health: (await response.json()) as { authentication: string },
            output: () => output,
          };
      } catch {
        // Not listening yet.
      }
      await sleep(200);
    }
    child.kill();
    return { child, health: null, output: () => output };
  };

  const open = await start(14481, null);
  check(
    open.health !== null,
    `it starts from exactly those files (${open.health ? 'serving /health' : open.output().slice(0, 160)})`,
  );
  check(
    open.health?.authentication === 'none',
    'with no secret it is open, exactly as the old image was',
  );
  open.child.kill();

  const locked = await start(14482, 'x'.repeat(48));
  check(
    locked.health?.authentication === 'required',
    'and with RELAY_TOKEN_SECRET set, it requires a token',
  );
  locked.child.kill();

  try {
    if (existsSync(join(image, 'node_modules'))) {
      rmSync(join(image, 'node_modules'), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
    rmSync(image, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Ignore cleanup failure in temp directory on Windows if file locks take time to release
  }
}

check(existsSync('docker/signaling/package.json'), 'the image keeps its own small manifest');

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll relay image checks passed.');
