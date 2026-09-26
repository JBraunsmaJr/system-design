/**
 * Generating the organization's recovery key (WS7-R5, R10), as an
 * operator does it - from the store image, with no source checked out:
 *
 *   docker run --rm -u $(id -u):$(id -g) -v ./keys:/keys \
 *     ghcr.io/jbraunsmajr/system-design-store:latest \
 *     generate-recovery-key --out /keys/recovery
 *
 * What must hold: a working run leaves both halves, the private one
 * readable by its owner only; a key is never overwritten; and a run that
 * fails leaves NOTHING behind. A public key without its private half is
 * the dangerous leftover - configured into a store, every document would
 * be escrowed to a key nobody holds.
 */
import { spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  chmodSync,
} from 'fs';
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

const run = (out: string) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/generate-recovery-key.ts', '--out', out],
    {
      encoding: 'utf8',
    },
  );

const scratch = mkdtempSync(join(tmpdir(), 'recovery-key-'));
try {
  console.log('=== A working run ===');
  {
    const out = join(scratch, 'ok', 'recovery');
    mkdirSync(join(scratch, 'ok'));
    const result = run(out);
    check(result.status === 0, 'it succeeds');
    check(
      existsSync(`${out}-public.pem`) && existsSync(`${out}-private.pem`),
      'and leaves both halves',
    );
    check(
      readFileSync(`${out}-public.pem`, 'utf8').includes('BEGIN PUBLIC KEY'),
      'the public half is a PEM public key',
    );
    if (process.platform !== 'win32') {
      check(
        (statSync(`${out}-private.pem`).mode & 0o077) === 0,
        'the private half is readable by its owner only',
      );
    }

    const again = run(out);
    check(
      again.status !== 0 && /Refusing to overwrite/.test(again.stderr),
      'running it again refuses to overwrite the key',
    );
  }

  console.log('\n=== A run that cannot finish leaves nothing ===');
  {
    const out = join(scratch, 'missing', 'recovery');
    const result = run(out);
    check(
      result.status !== 0 && /does not exist/.test(result.stderr),
      'a folder that does not exist is named, with what to do',
    );
    check(!/at writeFileSync|node:fs/.test(result.stderr), 'and no stack trace');
  }
  {
    // The private half can be written, the public half cannot: a dangling
    // symlink where the public key would go passes the "already exists"
    // check and then fails to write. This is the half-written case.
    mkdirSync(join(scratch, 'half'));
    const out = join(scratch, 'half', 'recovery');
    let symlinkCreated = false;
    try {
      symlinkSync(join(scratch, 'nowhere', 'public.pem'), `${out}-public.pem`);
      symlinkCreated = true;
    } catch {
      // Symlink creation on Windows requires elevated privileges / Developer Mode
    }

    if (symlinkCreated) {
      const result = run(out);
      check(result.status !== 0, 'when the second half cannot be written, it fails');
      check(
        !existsSync(`${out}-private.pem`),
        'and removes the first half, so no orphaned key is left behind',
      );
      check(
        /No recovery key was created/.test(result.stderr),
        'and says plainly that nothing was created',
      );
    } else {
      console.log(
        '  (symlink creation requires elevated privileges on Windows: half-written test checked in CI instead)',
      );
    }
  }
  if (process.getuid && process.getuid() !== 0) {
    // A folder this user cannot write - what an operator sees when the
    // container's user does not own the mounted folder. (Skipped as root,
    // which can write anywhere.)
    mkdirSync(join(scratch, 'locked'));
    chmodSync(join(scratch, 'locked'), 0o555);
    const result = run(join(scratch, 'locked', 'recovery'));
    check(
      result.status !== 0 && /-u \$\(id -u\):\$\(id -g\)/.test(result.stderr),
      'an unwritable folder explains how to run as yourself',
    );
    chmodSync(join(scratch, 'locked'), 0o755);
  } else {
    console.log('  (running as root: the unwritable-folder case is checked in CI instead)');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('\n=== The image can run it ===');
{
  const dockerfile = readFileSync('docker/store/Dockerfile', 'utf8');
  const entrypoint = readFileSync('docker/store/docker-entrypoint.sh', 'utf8');
  check(
    dockerfile.includes('scripts/generate-recovery-key.ts'),
    'the store image carries the tool',
  );
  check(
    dockerfile.includes('scripts/recover-document.ts'),
    'and the offline recovery tool beside it',
  );
  check(
    /generate-recovery-key/.test(entrypoint) && /recover-document/.test(entrypoint),
    'the entrypoint dispatches both by name',
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll recovery key tool checks passed.');
